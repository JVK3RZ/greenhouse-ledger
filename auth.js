(function(){
  const config = window.GREENHOUSE_SUPABASE;
  const client = window.supabase.createClient(config.url, config.publishableKey);
  let context = null;
  let onReady = null;

  function escapeHtml(value){
    return String(value).replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function authMarkup(mode='signin', message=''){
    const signingUp = mode === 'signup';
    return `<div class="auth-shell"><div class="auth-card">
      <div class="eyebrow">Greenhouse operations</div>
      <h1>Greenhouse Ledger</h1>
      <p class="sub">Sign in to securely manage your greenhouse team and inventory. Your existing device records remain stored offline.</p>
      <form id="auth-form" class="auth-form">
        ${signingUp?'<label>Display name<input name="displayName" autocomplete="name" required maxlength="80" /></label>':''}
        <label>Email<input name="email" type="email" autocomplete="email" required /></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required minlength="8" /></label>
        <button class="btn primary" type="submit">${signingUp?'Create account':'Sign in'}</button>
      </form>
      ${message?`<p class="auth-message">${escapeHtml(message)}</p>`:''}
      <button class="btn ghost auth-switch" data-mode="${signingUp?'signin':'signup'}">${signingUp?'Already have an account? Sign in':'New to Greenhouse Ledger? Create an account'}</button>
    </div></div>`;
  }

  function organizationMarkup(message=''){
    return `<div class="auth-shell"><div class="auth-card">
      <div class="eyebrow">One last step</div>
      <h1>Name your greenhouse</h1>
      <p class="sub">This creates the private workspace that will contain your locations, inventory, staff, and tasks.</p>
      <form id="organization-form" class="auth-form">
        <label>Business or greenhouse name<input name="name" required minlength="2" maxlength="120" placeholder="Example: Twilight Garden Greenhouse" /></label>
        <button class="btn primary" type="submit">Create workspace</button>
      </form>
      ${message?`<p class="auth-message">${escapeHtml(message)}</p>`:''}
      <button class="btn ghost" id="onboarding-signout">Sign out</button>
    </div></div>`;
  }

  function renderAuth(mode='signin', message=''){
    document.getElementById('app').innerHTML = authMarkup(mode,message);
    document.querySelector('.auth-switch').addEventListener('click',event=>renderAuth(event.currentTarget.dataset.mode));
    document.getElementById('auth-form').addEventListener('submit',event=>submitAuth(event,mode));
  }

  async function submitAuth(event, mode){
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email')||'').trim();
    const password = String(form.get('password')||'');
    event.currentTarget.querySelector('button[type="submit"]').disabled = true;
    const result = mode==='signup'
      ? await client.auth.signUp({email,password,options:{data:{display_name:String(form.get('displayName')||'').trim()}}})
      : await client.auth.signInWithPassword({email,password});
    if(result.error){ renderAuth(mode,result.error.message); return; }
    if(mode==='signup' && !result.data.session){
      renderAuth('signin','Check your email to confirm your account, then sign in.');
      return;
    }
    await routeSession(result.data.session);
  }

  async function routeSession(session){
    if(!session){ context=null; renderAuth(); return; }
    const {data:memberships,error} = await client.from('organization_members')
      .select('role, organization:organizations(id,name)')
      .eq('profile_id',session.user.id).limit(1);
    if(error){ renderAuth('signin',error.message); return; }
    if(!memberships.length){ renderOrganization(); return; }
    context = {session,profile:session.user,organization:memberships[0].organization,role:memberships[0].role};
    onReady(context);
  }

  function renderOrganization(message=''){
    document.getElementById('app').innerHTML = organizationMarkup(message);
    document.getElementById('organization-form').addEventListener('submit',createOrganization);
    document.getElementById('onboarding-signout').addEventListener('click',signOut);
  }

  async function createOrganization(event){
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name')||'').trim();
    const {data:{user}} = await client.auth.getUser();
    const organization = {id:crypto.randomUUID(),name,created_by:user.id};
    const {error:organizationError} = await client.from('organizations').insert(organization);
    if(organizationError){ renderOrganization(organizationError.message); return; }
    const {error:membershipError} = await client.from('organization_members')
      .insert({organization_id:organization.id,profile_id:user.id,role:'owner'});
    if(membershipError){ renderOrganization(membershipError.message); return; }
    await routeSession((await client.auth.getSession()).data.session);
  }

  async function signOut(){
    await client.auth.signOut();
    context = null;
    renderAuth();
  }

  async function initialize(options){
    onReady = options.onReady;
    const {data:{session}} = await client.auth.getSession();
    await routeSession(session);
    client.auth.onAuthStateChange((event,nextSession)=>{
      if(event==='SIGNED_OUT') routeSession(null);
      if(event==='SIGNED_IN' && !context) setTimeout(()=>routeSession(nextSession),0);
    });
  }

  window.LedgerAuth = {client,initialize,signOut,getContext:()=>context};
})();
