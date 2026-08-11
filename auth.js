(function(){
  const config = window.GREENHOUSE_SUPABASE;
  const REMEMBER_KEY = 'greenhouse-ledger-remember';
  const LOGIN_KEY = 'greenhouse-ledger-login-id';
  let rememberSession = localStorage.getItem(REMEMBER_KEY) === 'true';
  const authStorage = {
    getItem(key){ return (rememberSession ? localStorage : sessionStorage).getItem(key); },
    setItem(key,value){
      const target = rememberSession ? localStorage : sessionStorage;
      const other = rememberSession ? sessionStorage : localStorage;
      target.setItem(key,value); other.removeItem(key);
    },
    removeItem(key){ localStorage.removeItem(key); sessionStorage.removeItem(key); }
  };
  const client = window.supabase.createClient(config.url, config.publishableKey, {
    auth:{persistSession:true,storage:authStorage}
  });
  let context = null;
  let onReady = null;

  function escapeHtml(value){
    return String(value).replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function authMarkup(mode='signin', message=''){
    const signingUp = mode === 'signup';
    const rememberedLogin = rememberSession ? localStorage.getItem(LOGIN_KEY) || '' : '';
    return `<div class="auth-shell"><div class="auth-card">
      <div class="eyebrow">Greenhouse operations</div>
      <h1>Greenhouse Ledger</h1>
      <p class="sub">Sign in to securely manage your greenhouse team and inventory. Your existing device records remain stored offline.</p>
      <form id="auth-form" class="auth-form">
        ${signingUp?'<label>Display name<input name="displayName" autocomplete="name" required maxlength="80" /></label><label>Username<input name="username" autocomplete="username" required minlength="3" maxlength="30" pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,28}[A-Za-z0-9]" placeholder="greenhouse_manager" /><small>3–30 characters: letters, numbers, periods, hyphens, or underscores.</small></label>':''}
        <label>${signingUp?'Email':'Email or username'}<input name="login" ${signingUp?'type="email" autocomplete="email"':'autocomplete="username"'} required value="${escapeHtml(signingUp?'':rememberedLogin)}" /></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required minlength="8" /></label>
        ${signingUp?'':`<label class="remember-row"><input name="remember" type="checkbox" ${rememberSession?'checked':''} /> <span>Remember me on this device</span></label>`}
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
    const login = String(form.get('login')||'').trim();
    const password = String(form.get('password')||'');
    if(mode==='signin'){
      rememberSession = form.get('remember') === 'on';
      if(rememberSession){ localStorage.setItem(REMEMBER_KEY,'true'); localStorage.setItem(LOGIN_KEY,login); }
      else { localStorage.removeItem(REMEMBER_KEY); localStorage.removeItem(LOGIN_KEY); }
    }
    event.currentTarget.querySelector('button[type="submit"]').disabled = true;
    const result = mode==='signup'
      ? await client.auth.signUp({email:login,password,options:{
          emailRedirectTo:new URL('./',window.location.href).href,
          data:{display_name:String(form.get('displayName')||'').trim(),username:String(form.get('username')||'').trim().toLowerCase()}
        }})
      : await signIn(login,password);
    if(result.error){ renderAuth(mode,result.error.message); return; }
    if(mode==='signup' && !result.data.session){
      renderAuth('signin','Check your email to confirm your account, then sign in.');
      return;
    }
    await routeSession(result.data.session);
  }

  async function signIn(identifier,password){
    if(identifier.includes('@')) return client.auth.signInWithPassword({email:identifier,password});
    try{
      const response = await fetch(`${config.url}/functions/v1/username-login`,{
        method:'POST',headers:{'Content-Type':'application/json','apikey':config.publishableKey},
        body:JSON.stringify({username:identifier,password})
      });
      const payload = await response.json();
      if(!response.ok) return {data:{session:null},error:new Error(payload.error||'Invalid username or password.')};
      return client.auth.setSession({access_token:payload.access_token,refresh_token:payload.refresh_token});
    }catch(error){ return {data:{session:null},error:new Error('Username sign-in is temporarily unavailable. You can still sign in with your email.')}; }
  }

  async function routeSession(session){
    if(!session){ context=null; renderAuth(); return; }
    const invitationCode = new URL(location.href).searchParams.get('invite');
    if(invitationCode){
      const accepted = await client.rpc('accept_organization_invitation',{invitation_code:invitationCode});
      if(accepted.error){ renderAuth('signin',accepted.error.message); return; }
      const cleanUrl=new URL(location.href); cleanUrl.searchParams.delete('invite'); history.replaceState({},'',cleanUrl);
    }
    const profileResult = await client.from('profiles').select('username').eq('id',session.user.id).single();
    if(profileResult.error){ renderAuth('signin',profileResult.error.message); return; }
    if(!profileResult.data.username){ renderUsername(); return; }
    const {data:memberships,error} = await client.from('organization_members')
      .select('role, organization:organizations(id,name,currency_code,timezone,low_stock_threshold)')
      .eq('profile_id',session.user.id).limit(1);
    if(error){ renderAuth('signin',error.message); return; }
    if(!memberships.length){ renderOrganization(); return; }
    context = {session,profile:session.user,organization:memberships[0].organization,role:memberships[0].role};
    onReady(context);
  }

  function renderUsername(message=''){
    document.getElementById('app').innerHTML = `<div class="auth-shell"><div class="auth-card"><div class="eyebrow">Account setup</div><h1>Choose your username</h1><p class="sub">Use this unique username or your email whenever you sign in.</p><form id="username-form" class="auth-form"><label>Username<input name="username" autocomplete="username" required minlength="3" maxlength="30" pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,28}[A-Za-z0-9]" /></label><button class="btn primary" type="submit">Save username</button></form>${message?`<p class="auth-message">${escapeHtml(message)}</p>`:''}<button class="btn ghost" id="username-signout">Sign out</button></div></div>`;
    document.getElementById('username-form').addEventListener('submit',saveUsername);
    document.getElementById('username-signout').addEventListener('click',signOut);
  }

  async function saveUsername(event){
    event.preventDefault();
    const username=String(new FormData(event.currentTarget).get('username')||'').trim().toLowerCase();
    const {data:{user}}=await client.auth.getUser();
    const {error}=await client.from('profiles').update({username}).eq('id',user.id);
    if(error){ renderUsername(error.code==='23505'?'That username is already taken. Choose another.':error.message); return; }
    await routeSession((await client.auth.getSession()).data.session);
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
