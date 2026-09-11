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

  function membershipAccessAllowed(membership){return membership?.status!=='suspended'&&organizationAccessAllowed(membership?.entitlement);}

  function authMarkup(mode='signin', message=''){
    const rememberedLogin=rememberSession?localStorage.getItem(LOGIN_KEY)||'':'';
    return `<div class="auth-shell"><div class="auth-card"><div class="eyebrow">Greenhouse operations</div><h1>Greenhouse Ledger</h1>
      <p class="sub">${invitationPreview?`Join ${escapeHtml(invitationPreview.organization_name)} as ${escapeHtml(invitationPreview.role)}. Sign in with ${escapeHtml(invitationPreview.email)}. New team members should open the activation email sent by their owner or manager.`:'Sign in to your greenhouse, or request an owner account for your business.'}</p>
      <form id="auth-form" class="auth-form"><label>Email or username<input name="login" autocomplete="username" required value="${escapeHtml(rememberedLogin)}" /></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required minlength="8" /></label>
      <label class="remember-row"><input name="remember" type="checkbox" ${rememberSession?'checked':''} /> <span>Remember me on this device</span></label>
      <button class="btn primary" type="submit">Sign in</button></form>
      ${message?`<p class="auth-message" role="status">${escapeHtml(message)}</p>`:''}
      <button class="btn ghost auth-switch">Request owner account</button></div></div>`;
  }

  function renderOwnerRequest(message=''){
    document.getElementById('app').innerHTML=`<div class="auth-shell"><div class="auth-card"><h1>Request owner account</h1><p class="sub">Tell us about your greenhouse. Once approved, you will receive a private email to finish account setup.</p><form id="owner-request-form" class="auth-form"><label>Your name<input name="name" autocomplete="name" required minlength="2" maxlength="80"></label><label>Business name<input name="business" required minlength="2" maxlength="120"></label><label>Email<input name="email" type="email" autocomplete="email" required maxlength="254"></label><button class="btn primary">Submit request</button></form>${message?`<p role="status">${escapeHtml(message)}</p>`:''}<button id="request-back" class="btn ghost">${context?'Back to workspace':'Back to sign in'}</button></div></div>`;
    document.getElementById('request-back').onclick=()=>context?onReady(context):renderAuth();
    document.getElementById('owner-request-form').onsubmit=async event=>{
      event.preventDefault();const f=new FormData(event.currentTarget);event.currentTarget.querySelector('button').disabled=true;
      try{
        const {error}=await client.rpc('request_owner_account',{request_email:String(f.get('email')),request_name:String(f.get('name')),business_name:String(f.get('business'))});
        if(error)throw error;
        document.getElementById('owner-request-form').innerHTML='<p role="status">Your request has been received. If approved, an activation invitation will arrive at the email you provided.</p>';
      }catch(error){renderOwnerRequest(error.message);}
    };
  }

  function activationError(message){
    document.getElementById('app').innerHTML=`<div class="auth-shell"><div class="auth-card"><h1>Invitation needs attention</h1><p role="alert">${escapeHtml(message)}</p><button class="btn" id="activation-exit">Return to sign in</button></div></div>`;
    document.getElementById('activation-exit').onclick=async()=>{clearInvitationUrl();await client.auth.signOut();renderAuth();};
  }

  function clearInvitationUrl(){
    const clean=new URL(location.href);['invite','owner_invite','activate'].forEach(key=>clean.searchParams.delete(key));clean.hash='';history.replaceState({},'',clean);
    invitationPreview=null;
  }

  async function renderActivation(session,message=''){
    const url=new URL(location.href);const ownerCode=url.searchParams.get('owner_invite');
    let target;
    if(ownerCode){
      const result=await client.rpc('get_owner_activation',{invitation_code:ownerCode});
      if(result.error){activationError(result.error.message);return;}target=result.data;
    }else{
      const result=await client.rpc('get_organization_invitation_details',{invitation_code:url.searchParams.get('invite')});
      if(result.error||!result.data?.length){activationError('Invitation is expired, revoked, or already accepted.');return;}
      target=result.data[0];
    }
    const {data:{user},error:userError}=await client.auth.getUser();
    if(userError||!user||user.email?.toLowerCase()!==target.email.toLowerCase()||!user.email_confirmed_at){activationError('Open the activation email for the invited email address.');return;}
    const {data:profile,error:profileError}=await client.from('profiles').select('username,display_name').eq('id',user.id).single();
    if(profileError){activationError(profileError.message);return;}
    const setup=!profile.username;
    document.getElementById('app').innerHTML=`<div class="auth-shell"><div class="auth-card"><h1>${setup?'Finish account setup':'Accept invitation'}</h1><p>${escapeHtml(target.business_name||target.organization_name)} · ${escapeHtml(target.email)}</p><form id="activation-form" class="auth-form">${setup?'<label>Display name<input name="name" required maxlength="80" autocomplete="name"></label><label>Username<input name="username" required minlength="3" maxlength="30" pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,28}[A-Za-z0-9]" autocomplete="username"></label><label>Password<input name="password" type="password" minlength="8" required autocomplete="new-password"></label>':'<p>Your existing login will remain the same.</p>'}<button class="btn primary">${ownerCode?'Activate owner workspace':'Join greenhouse'}</button></form>${message?`<p role="alert">${escapeHtml(message)}</p>`:''}<button class="btn ghost" id="activation-signout">Sign out</button></div></div>`;
    document.getElementById('activation-signout').onclick=signOut;
    document.getElementById('activation-form').onsubmit=async event=>{
      event.preventDefault();const f=new FormData(event.currentTarget);event.currentTarget.querySelector('button').disabled=true;
      try{
        if(setup){
          const password=String(f.get('password'));
          const updated=await client.auth.updateUser({password});if(updated.error)throw updated.error;
          const saved=await client.from('profiles').update({username:String(f.get('username')).toLowerCase().trim(),display_name:String(f.get('name')).trim()}).eq('id',user.id);if(saved.error)throw saved.error;
        }
        const result=await client.rpc(ownerCode?'accept_owner_activation':'accept_organization_invitation',{invitation_code:ownerCode||url.searchParams.get('invite')});
        if(result.error)throw result.error;
        clearInvitationUrl();await routeSession(session,{preferredOrganizationId:result.data});
      }catch(error){await renderActivation(session,error.message);}
    };
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
    document.querySelector('.auth-switch').addEventListener('click',()=>renderOwnerRequest());
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
    const result=await signIn(login,password);
    if(result.error){renderAuth('signin',result.error.message);return;}
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
    const activationUrl=new URL(location.href);
    if(activationUrl.searchParams.has('owner_invite')||activationUrl.searchParams.has('invite')){await renderActivation(session);return;}
    if(prepareDemo){
      try{await prepareDemoSession(session,freshSignIn);}
      catch(error){await client.auth.signOut();renderAuth('signin',error.message);return;}
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
    if(!memberships.length){ if(demoAccount||administratorResult.data===true)renderOrganization();else renderAwaitingInvitation();return; }
    const storageKey=`${ACTIVE_ORGANIZATION_KEY}-${session.user.id}`;
    const requested=preferredOrganizationId||localStorage.getItem(storageKey);
    const active=memberships.find(item=>item.organization?.id===requested)||memberships[0];
    localStorage.setItem(storageKey,active.organization.id);
    context = {session,profile:{...session.user,...profileResult.data},organization:active.organization,role:active.role,membershipStatus:active.status||'active',memberships,entitlement:active.entitlement,accessBlocked:!membershipAccessAllowed(active),acceptedInvitation,isDemo:demoAccount,isPlatformAdmin:administratorResult.data===true};
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

  function renderAwaitingInvitation(){
    document.getElementById('app').innerHTML='<div class="auth-shell"><div class="auth-card"><h1>Waiting for an invitation</h1><p>Open your approved owner activation email or ask your greenhouse owner for a team invitation.</p><button class="btn" id="awaiting-request">Request owner account</button><button class="btn ghost" id="awaiting-signout">Sign out</button></div></div>';
    document.getElementById('awaiting-request').onclick=()=>renderOwnerRequest();document.getElementById('awaiting-signout').onclick=signOut;
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

  function startCreateOrganization(){if(!context)return;if(!context.isPlatformAdmin&&!context.isDemo){renderOwnerRequest();return;}creatingAdditionalOrganization=true;renderOrganization('',true);}

  async function switchOrganization(organizationId){
    if(!context||organizationId===context.organization.id)return;
    const membership=context.memberships.find(item=>item.organization?.id===organizationId);
    if(!membership){alert('You no longer have access to that organization.');return;}
    localStorage.setItem(`${ACTIVE_ORGANIZATION_KEY}-${context.session.user.id}`,organizationId);
    context={...context,organization:membership.organization,role:membership.role,membershipStatus:membership.status||'active',entitlement:membership.entitlement,accessBlocked:!membershipAccessAllowed(membership),acceptedInvitation:null};
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

  async function refreshContext(){const {data:{session}}=await client.auth.getSession();await routeSession(session,{prepareDemo:false,preferredOrganizationId:context?.organization?.id});}

  async function initialize(options){
    onReady = options.onReady;
    const callbackHash=new URLSearchParams(location.hash.slice(1));
    if(callbackHash.has('error')){activationError('The email link has expired or was already used. Ask for a new activation email.');return;}
    const invitationCode = new URL(location.href).searchParams.get('invite');
    if(invitationCode){
      const preview=await client.rpc('get_organization_invitation_details',{invitation_code:invitationCode});
      if(preview.error||!preview.data?.length){ clearInvitationUrl();renderAuth('signin','This invitation link is no longer active. If you already accepted it, sign in normally below with your email or username. If you never joined the team, ask the owner for a new invitation.'); return; }
      invitationPreview=preview.data?.[0]||null;
    }
    const {data:{session}} = await client.auth.getSession();
    await routeSession(session);
    client.auth.onAuthStateChange((event,nextSession)=>{
      if(event==='SIGNED_OUT') routeSession(null);

    });
  }

  window.LedgerAuth = {client,initialize,signOut,startCreateOrganization,switchOrganization,refreshContext,getContext:()=>context,isDemo:()=>demoAccount};
})();
