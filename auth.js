(function(){
  const config = window.GREENHOUSE_SUPABASE;
  const REMEMBER_KEY = 'greenhouse-ledger-remember';
  const LOGIN_KEY = 'greenhouse-ledger-login-id';
  const DEMO_SESSION_KEY = 'greenhouse-ledger-demo-session';
  const ACTIVE_ORGANIZATION_KEY = 'greenhouse-ledger-active-organization';
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
  let invitationPreview = null;
  let acceptedInvitation = null;
  let demoAccount = false;
  let preparedSessionUser = null;
  let demoPreparation = null;
  let creatingAdditionalOrganization = false;

  function escapeHtml(value){
    return String(value).replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function organizationAccessAllowed(entitlement){
    if(!entitlement)return false;
    if(entitlement.access_status==='active')return true;
    if(entitlement.access_status==='trialing')return Boolean(entitlement.trial_ends_at&&new Date(entitlement.trial_ends_at)>new Date());
    if(entitlement.access_status==='grace_period')return !entitlement.current_period_end||new Date(entitlement.current_period_end)>new Date();
    return false;
  }

  function authMarkup(mode='signin', message=''){
    const signingUp = mode === 'signup';
    const rememberedLogin = rememberSession ? localStorage.getItem(LOGIN_KEY) || '' : '';
    const inviteEmail = invitationPreview?.email || '';
    const invitePanel = invitationPreview?`<div class="invitation-welcome"><div class="eyebrow">Staff invitation</div><h2>Join ${escapeHtml(invitationPreview.organization_name)}</h2><div class="invitation-facts"><span><small>Role</small><strong>${escapeHtml(invitationPreview.role)}</strong></span><span><small>Reserved for</small><strong>${escapeHtml(inviteEmail)}</strong></span><span><small>Expires</small><strong>${new Date(invitationPreview.expires_at).toLocaleDateString()}</strong></span></div><p>Sign in or create an account using the email shown above. Greenhouse Ledger will confirm the match before adding you to the team.</p></div>`:'';
    return `<div class="auth-shell"><div class="auth-card">
      ${invitePanel}
      <div class="eyebrow">Greenhouse operations</div>
      <h1>Greenhouse Ledger</h1>
      <p class="sub">${invitationPreview?'Sign in with the invited email, or create the staff account that will accept this invitation.':'Create the owner account first, then set up the private business workspace and invite your team.'}</p>
      <form id="auth-form" class="auth-form">
        ${signingUp?'<label>Display name<input name="displayName" autocomplete="name" required maxlength="80" /></label><label>Username<input name="username" autocomplete="username" required minlength="3" maxlength="30" pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,28}[A-Za-z0-9]" placeholder="greenhouse_manager" /><small>3–30 characters: letters, numbers, periods, hyphens, or underscores.</small></label>':''}
        <label>${signingUp?'Email':'Email or username'}<input name="login" ${signingUp?'type="email" autocomplete="email"':'autocomplete="username"'} required value="${escapeHtml(signingUp?inviteEmail:rememberedLogin)}" ${signingUp&&inviteEmail?'readonly':''} /></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required minlength="8" /></label>
        ${signingUp?'':`<label class="remember-row"><input name="remember" type="checkbox" ${rememberSession?'checked':''} /> <span>Remember me on this device</span></label>`}
        <button class="btn primary" type="submit">${signingUp?(invitationPreview?'Create account & accept':'Create owner account'):(invitationPreview?'Sign in & accept':'Sign in')}</button>
      </form>
      ${message?`<p class="auth-message">${escapeHtml(message)}</p>`:''}
      <button class="btn ghost auth-switch" data-mode="${signingUp?'signin':'signup'}">${signingUp?'Already have an account? Sign in':invitationPreview?'Need an account? Create one for this invitation':'New owner? Create an account'}</button>
    </div></div>`;
  }

  function organizationMarkup(message='',additional=false){
    return `<div class="auth-shell"><div class="auth-card">
      <div class="eyebrow">${additional?'New organization':'One last step'}</div>
      <h1>${additional?'Create another workspace':'Name your greenhouse'}</h1>
      <p class="sub">This creates a separate private workspace for its own locations, inventory, staff, settings, and activity.</p>
      <form id="organization-form" class="auth-form">
        <label>Business or greenhouse name<input name="name" required minlength="2" maxlength="120" placeholder="Example: Twilight Garden Greenhouse" /></label>
        <button class="btn primary" type="submit">Create workspace</button>
      </form>
      ${message?`<p class="auth-message">${escapeHtml(message)}</p>`:''}
      ${additional?'<button class="btn ghost" id="organization-cancel">Back to current workspace</button>':''}
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
      sessionStorage.removeItem(DEMO_SESSION_KEY);
      if(rememberSession){ localStorage.setItem(REMEMBER_KEY,'true'); localStorage.setItem(LOGIN_KEY,login); }
      else { localStorage.removeItem(REMEMBER_KEY); localStorage.removeItem(LOGIN_KEY); }
    }
    event.currentTarget.querySelector('button[type="submit"]').disabled = true;
    const result = mode==='signup'
      ? await client.auth.signUp({email:login,password,options:{
          emailRedirectTo:window.location.href,
          data:{display_name:String(form.get('displayName')||'').trim(),username:String(form.get('username')||'').trim().toLowerCase()}
        }})
      : await signIn(login,password);
    if(result.error){ renderAuth(mode,result.error.message); return; }
    if(mode==='signup' && !result.data.session){
      renderAuth('signin','Check your email to confirm your account, then sign in.');
      return;
    }
    await routeSession(result.data.session,{freshSignIn:true});
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

  async function demoStatus(){
    const {data,error}=await client.rpc('is_demo_account');
    if(error)throw error;
    return data===true;
  }

  async function resetDemoWorkspace(){
    const {data:{session}}=await client.auth.getSession();
    if(!session)throw new Error('Authentication required.');
    const response=await fetch(`${config.url}/functions/v1/reset-demo-workspace`,{
      method:'POST',headers:{'Content-Type':'application/json','apikey':config.publishableKey,'Authorization':`Bearer ${session.access_token}`},body:'{}'
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||'Demo workspace could not be reset.');
    return payload;
  }

  async function prepareDemoSession(session,freshSignIn=false){
    if(preparedSessionUser===session.user.id)return;
    if(demoPreparation)return demoPreparation;
    demoPreparation=(async()=>{
      demoAccount=await demoStatus();
      const activeDemoSession=sessionStorage.getItem(DEMO_SESSION_KEY)===session.user.id;
      if(demoAccount&&(freshSignIn||!activeDemoSession))await resetDemoWorkspace();
      if(demoAccount)sessionStorage.setItem(DEMO_SESSION_KEY,session.user.id);
      preparedSessionUser=session.user.id;
    })();
    try{await demoPreparation;}finally{demoPreparation=null;}
  }

  async function routeSession(session,{prepareDemo=true,freshSignIn=false,preferredOrganizationId=null}={}){
    if(!session){ context=null; renderAuth(); return; }
    if(prepareDemo){
      try{await prepareDemoSession(session,freshSignIn);}
      catch(error){await client.auth.signOut();renderAuth('signin',error.message);return;}
    }
    const invitationCode = new URL(location.href).searchParams.get('invite');
    if(invitationCode){
      acceptedInvitation=invitationPreview?{organizationName:invitationPreview.organization_name,role:invitationPreview.role}:null;
      const accepted = await client.rpc('accept_organization_invitation',{invitation_code:invitationCode});
      if(accepted.error){ renderAuth('signin',accepted.error.message); return; }
      preferredOrganizationId=accepted.data;
      const cleanUrl=new URL(location.href); cleanUrl.searchParams.delete('invite'); history.replaceState({},'',cleanUrl);
      invitationPreview=null;
    }
    const profileResult = await client.from('profiles').select('username,display_name').eq('id',session.user.id).single();
    if(profileResult.error){ renderAuth('signin',profileResult.error.message); return; }
    if(!profileResult.data.username){ renderUsername(); return; }
    const [membershipResult,administratorResult]=await Promise.all([
      client.rpc('list_account_organizations'),
      client.rpc('is_platform_administrator')
    ]);
    if(membershipResult.error){ renderAuth('signin',membershipResult.error.message); return; }
    if(administratorResult.error){ renderAuth('signin',administratorResult.error.message); return; }
    const memberships=Array.isArray(membershipResult.data)?membershipResult.data:[];
    if(!memberships.length){ renderOrganization(); return; }
    const storageKey=`${ACTIVE_ORGANIZATION_KEY}-${session.user.id}`;
    const requested=preferredOrganizationId||localStorage.getItem(storageKey);
    const active=memberships.find(item=>item.organization?.id===requested)||memberships[0];
    localStorage.setItem(storageKey,active.organization.id);
    context = {session,profile:{...session.user,...profileResult.data},organization:active.organization,role:active.role,memberships,entitlement:active.entitlement,accessBlocked:!organizationAccessAllowed(active.entitlement),acceptedInvitation,isDemo:demoAccount,isPlatformAdmin:administratorResult.data===true};
    creatingAdditionalOrganization=false;
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

  function renderOrganization(message='',additional=creatingAdditionalOrganization){
    creatingAdditionalOrganization=additional;
    document.getElementById('app').innerHTML = organizationMarkup(message,additional);
    document.getElementById('organization-form').addEventListener('submit',createOrganization);
    document.getElementById('onboarding-signout').addEventListener('click',signOut);
    document.getElementById('organization-cancel')?.addEventListener('click',()=>{creatingAdditionalOrganization=false;onReady(context);});
  }

  async function createOrganization(event){
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name')||'').trim();
    const {data:organizationId,error}=await client.rpc('create_organization_workspace',{workspace_name:name});
    if(error){ renderOrganization(error.message); return; }
    await routeSession((await client.auth.getSession()).data.session,{prepareDemo:false,preferredOrganizationId:organizationId});
  }

  function startCreateOrganization(){if(!context)return;creatingAdditionalOrganization=true;renderOrganization('',true);}

  async function switchOrganization(organizationId){
    if(!context||organizationId===context.organization.id)return;
    const membership=context.memberships.find(item=>item.organization?.id===organizationId);
    if(!membership){alert('You no longer have access to that organization.');return;}
    localStorage.setItem(`${ACTIVE_ORGANIZATION_KEY}-${context.session.user.id}`,organizationId);
    context={...context,organization:membership.organization,role:membership.role,entitlement:membership.entitlement,accessBlocked:!organizationAccessAllowed(membership.entitlement),acceptedInvitation:null};
    window.CloudLedger?.reset?.();
    if(typeof window.render==='function')window.render();
    await onReady(context);
  }

  async function signOut(){
    if(demoAccount){
      const confirmed=confirm('Sign out and reset this demo? All greenhouse data created during this demonstration will be permanently cleared.');
      if(!confirmed)return;
      try{await resetDemoWorkspace();}
      catch(error){alert(`${error.message} You are still signed in so the demo data is not left without notice.`);return;}
    }
    await client.auth.signOut();
    context = null;
    demoAccount = false;
    preparedSessionUser = null;
    sessionStorage.removeItem(DEMO_SESSION_KEY);
    renderAuth();
  }

  async function initialize(options){
    onReady = options.onReady;
    const invitationCode = new URL(location.href).searchParams.get('invite');
    if(invitationCode){
      const preview=await client.rpc('get_organization_invitation_details',{invitation_code:invitationCode});
      if(preview.error||!preview.data?.length){ renderAuth('signin','This invitation link is no longer active. If you already accepted it, sign in normally below with your email or username. If you never joined the team, ask the owner for a new invitation.'); return; }
      invitationPreview=preview.data?.[0]||null;
    }
    const {data:{session}} = await client.auth.getSession();
    await routeSession(session);
    client.auth.onAuthStateChange((event,nextSession)=>{
      if(event==='SIGNED_OUT') routeSession(null);
      if(event==='SIGNED_IN' && !context) setTimeout(()=>routeSession(nextSession),0);
    });
  }

  window.LedgerAuth = {client,initialize,signOut,startCreateOrganization,switchOrganization,getContext:()=>context,isDemo:()=>demoAccount};
})();
