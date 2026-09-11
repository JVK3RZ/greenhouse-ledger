(function(){
  const DEFAULTS={primary:'#8ba46c',accent:'#d68c5f',background:'#241d15'};
  let section='account';
  let logoUrl='';
  let pendingLogo=null;
  let pendingLogoUrl='';
  let billing=null;
  let billingLoading=false;

  const context=()=>LedgerAuth.getContext();
  const org=()=>context().organization;
  const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const hex=value=>/^#[0-9a-f]{6}$/i.test(value||'')?value.toLowerCase():null;
  const rgb=value=>{const clean=hex(value).slice(1);return [0,2,4].map(index=>parseInt(clean.slice(index,index+2),16));};
  const toHex=values=>'#'+values.map(value=>Math.max(0,Math.min(255,Math.round(value))).toString(16).padStart(2,'0')).join('');
  const mix=(a,b,weight)=>toHex(rgb(a).map((value,index)=>value+(rgb(b)[index]-value)*weight));
  const luminance=value=>{const channels=rgb(value).map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;});return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];};
  const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);

  function palette(){
    return {primary:hex(org().brand_primary)||DEFAULTS.primary,accent:hex(org().brand_accent)||DEFAULTS.accent,background:hex(org().brand_background)||DEFAULTS.background};
  }
  function safeForeground(background){return contrast(background,'#f7f4ec')>=4.5?'#f7f4ec':'#171a16';}
  function applyTheme(next=palette()){
    const root=document.documentElement;
    const ink=safeForeground(next.background);
    const darkInk=ink==='#f7f4ec';
    root.style.setProperty('--soil',next.background);
    root.style.setProperty('--soil-2',mix(next.background,darkInk?'#ffffff':'#000000',.08));
    root.style.setProperty('--card',mix(next.background,darkInk?'#ffffff':'#000000',.12));
    root.style.setProperty('--card-2',mix(next.background,darkInk?'#ffffff':'#000000',.17));
    root.style.setProperty('--moss',next.primary);
    root.style.setProperty('--moss-light',contrast(next.primary,next.background)>=3?next.primary:mix(next.primary,darkInk?'#ffffff':'#000000',.35));
    root.style.setProperty('--clay',next.accent);
    root.style.setProperty('--clay-light',contrast(next.accent,next.background)>=3?next.accent:mix(next.accent,darkInk?'#ffffff':'#000000',.3));
    root.style.setProperty('--ink',ink);
    root.style.setProperty('--ink-dim',mix(ink,next.background,.28));
    root.style.setProperty('--parchment',ink);
    root.style.setProperty('--sand',mix(next.accent,ink,.38));
    root.style.setProperty('--line',darkInk?'rgba(255,255,255,.14)':'rgba(0,0,0,.16)');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',next.background);
  }

  async function initialize(){
    applyTheme();
    const path=org().brand_logo_path;
    if(path){
      const {data}=await LedgerAuth.client.storage.from('greenhouse-photos').createSignedUrl(path,3600);
      logoUrl=data?.signedUrl||'';
    }
    const billingResult=new URL(location.href).searchParams.get('billing');
    if(billingResult){showToast(billingResult==='success'?'Checkout completed. Subscription access will update after Stripe confirms payment.':'Checkout canceled. No billing changes were made.');history.replaceState({},'',location.pathname+location.hash);}
  }
  function brandLogoMarkup(){return logoUrl?`<img class="brand-logo" src="${esc(logoUrl)}" alt="${esc(org().name)} logo">`:'';}
  function toggleMenu(event){
    event.stopPropagation();
    const button=event.currentTarget;
    const menu=button.nextElementSibling;
    menu.hidden=!menu.hidden;
    button.setAttribute('aria-expanded',String(!menu.hidden));
    if(!menu.hidden) setTimeout(()=>document.addEventListener('click',closeMenu,{once:true}),0);
  }
  function closeMenu(){const menu=document.querySelector('.settings-menu');if(menu)menu.hidden=true;}
  function open(next){section=next;activeTab='settings';render();if(next==='billing')loadBilling();}
  function sectionButton(key,label){return `<button class="tab ${section===key?'active':''}" onclick="Settings.open('${key}')">${label}</button>`;}

  function renderMarkup(){
    const p=palette();
    const account=context().profile;
    const canBrand=['owner','manager'].includes(context().role);
    return `<div class="section-label">Settings</div><div class="tabs settings-tabs">${sectionButton('account','Account & security')}${sectionButton('business','Business profile')}${context().role==='owner'?sectionButton('billing','Plan & billing'):''}${sectionButton('email','Email & invitations')}${sectionButton('brand','Brand Studio')}${sectionButton('about','About')}</div>
      ${section==='account'?accountMarkup(account):section==='business'?WorkspaceSettings.renderMarkup():section==='billing'?billingMarkup():section==='email'?emailMarkup():section==='about'?aboutMarkup():brandMarkup(p,canBrand)}`;
  }
  function accountMarkup(account){
    const demo=context().isDemo===true;
    return `<div class="settings-grid">
      <section class="card settings-section"><h2>Username</h2><p class="sub">Used with your email as an alternative way to sign in.</p><form class="stack-form" onsubmit="Settings.saveUsername(event)"><label>Username<input name="username" autocomplete="username" required minlength="3" maxlength="30" pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,28}[A-Za-z0-9]" value="${esc(account.username||'')}"></label><button class="btn primary">Update username</button></form></section>
      <section class="card settings-section"><h2>Email address</h2><p class="sub">A confirmation may be sent to both your current and new address.</p><form class="stack-form" onsubmit="Settings.saveEmail(event)"><label>Current email<input value="${esc(context().session.user.email||'')}" disabled></label><label>New email<input name="email" type="email" autocomplete="email" required></label><button class="btn primary">Update email</button></form></section>
      <section class="card settings-section"><h2>Password</h2><p class="sub">We verify your current password before replacing it.</p><form class="stack-form" onsubmit="Settings.savePassword(event)"><label>Current password<input name="current" type="password" autocomplete="current-password" required minlength="8"></label><label>New password<input name="password" type="password" autocomplete="new-password" required minlength="8"></label><label>Confirm new password<input name="confirm" type="password" autocomplete="new-password" required minlength="8"></label><button class="btn primary">Change password</button></form></section>
      <section class="card settings-section"><h2>${demo?'Demo session':'Session'}</h2><p class="sub">${demo?'Signing out clears the greenhouse workspace created during this demonstration. The reusable demo login remains available.':'Sign out of Greenhouse Ledger on this device.'}</p><button class="btn ${demo?'primary':''}" onclick="LedgerAuth.signOut()">${demo?'Sign out and reset demo':'Sign out'}</button></section>
    </div>`;
  }
  function brandMarkup(p,canBrand){
    const image=pendingLogoUrl||logoUrl;
    if(!canBrand)return `<div class="card"><h2>Brand Studio</h2><p class="sub">Your organization’s owner or manager controls the shared logo and colors.</p>${previewMarkup(p,image)}</div>`;
    return `<section class="card settings-section"><h2>Brand Studio</h2><p class="sub">Give every team member the same company-branded workspace. Upload a logo for automatic suggestions or choose colors manually, preview them, then publish.</p>
      <div class="settings-grid"><div><label class="logo-drop">${image?`<img src="${esc(image)}" alt="Logo preview">`:'<span><strong>Upload company logo</strong><br><small>PNG, JPEG, WebP, or SVG · up to 2 MB</small></span>'}<input id="brand-logo-file" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onchange="Settings.chooseLogo(event)"></label></div>
      <form id="brand-form" class="stack-form" oninput="Settings.preview()" onsubmit="Settings.saveBrand(event)"><label>Primary color<input name="primary" type="color" value="${p.primary}"></label><label>Accent color<input name="accent" type="color" value="${p.accent}"></label><label>Background color<input name="background" type="color" value="${p.background}"></label><div class="brand-actions"><button class="btn primary" type="submit">Publish branding</button><button class="btn" type="button" onclick="Settings.resetBrand()">Reset default</button></div></form></div>
      <div id="brand-preview">${previewMarkup(p,image)}</div><div id="settings-status" class="settings-status" aria-live="polite"></div></section>`;
  }
  function emailMarkup(){
    if(context().isDemo)return `<section class="card settings-section"><div class="settings-heading"><div><h2>Email delivery</h2><p class="sub">External email is intentionally disabled for the reusable demo account.</p></div><span class="status-badge status-pending">Demo mode</span></div><div class="sync-notice"><strong>Safe demonstration:</strong> create a link-only invitation to show the invitation lifecycle without contacting a real recipient.</div><div class="settings-facts"><span><small>Invitation lifetime</small><strong>7 days</strong></span><span><small>Acceptance</small><strong>Single-use and email-locked</strong></span><span><small>Reset behavior</small><strong>Invitations clear with the demo workspace</strong></span></div></section>`;
    const invitations=CloudLedger.getData().invitations||[];
    const domainBlocked=invitations.some(item=>/can only send testing emails|verify a domain/i.test(item.delivery_error||''));
    const sent=invitations.some(item=>item.sent_at);
    const state=domainBlocked?'Setup required':sent?'Connected':'Not tested';
    const badge=domainBlocked?'delivery_failed':sent?'accepted':'pending';
    return `<div class="settings-grid"><section class="card settings-section"><div class="settings-heading"><div><h2>Email delivery</h2><p class="sub">Status for invitations sent from this workspace.</p></div><span class="status-badge status-${badge}">${state}</span></div>${domainBlocked?'<div class="sync-notice offline"><strong>Verify a sending domain.</strong> Resend is currently in testing mode, so it can only email the account that created the API key.</div>':sent?'<div class="sync-notice"><strong>Email delivery is working.</strong> Invitation links remain available as a fallback.</div>':'<p class="report-note">No delivery result is available yet. Create an invitation and choose Send by email to test the current configuration.</p>'}<div class="settings-facts"><span><small>Invitation lifetime</small><strong>7 days</strong></span><span><small>Acceptance</small><strong>Single-use and email-locked</strong></span><span><small>Fallback</small><strong>Copy and message the private link</strong></span></div></section>
      <section class="card settings-section"><h2>Domain setup checklist</h2><ol class="settings-checklist"><li>Purchase or use a business domain.</li><li>Add the domain in Resend and copy its DNS records.</li><li>Add those records at the domain provider.</li><li>After verification, change <code>INVITATION_FROM_EMAIL</code> to an address on that domain.</li><li>Send a new test invitation and confirm delivery.</li></ol><p class="report-note">API keys and provider secrets remain protected in Supabase and are never shown in the browser.</p></section></div>`;
  }
  function billingMarkup(){
    if(context().role!=='owner')return `<section class="card settings-section"><h2>Plan & billing</h2><p class="sub">Only an active organization owner can manage billing.</p></section>`;
    if(context().isDemo)return `<section class="card settings-section"><h2>Plan & billing</h2><p class="sub">Checkout is disabled in reusable demo mode.</p></section>`;
    const value=billing||context().entitlement||{};
    const period=value.current_period_end?new Date(value.current_period_end).toLocaleDateString():'Not scheduled';
    const trial=value.trial_ends_at?new Date(value.trial_ends_at).toLocaleDateString():'None';
    const plans=[['pilot','Founding Pilot','$29 / month','Up to 5 active employees'],['starter','Starter','$49 / month','Up to 10 active employees'],['growth','Growth','$99 / month','Up to 25 active employees']];
    return `<div class="settings-grid"><section class="card settings-section"><div class="settings-heading"><div><h2>Current subscription</h2><p class="sub">Stripe controls payment details; Greenhouse Ledger enforces access and staff limits.</p></div><span class="status-badge status-${value.access_status==='active'?'accepted':'pending'}">${esc(String(value.access_status||'loading').replaceAll('_',' '))}</span></div><div class="settings-facts"><span><small>Plan</small><strong>${esc(String(value.plan||'trial').replaceAll('_',' '))}</strong></span><span><small>Staff limit</small><strong>${Number(value.staff_limit||0)}</strong></span><span><small>Trial ends</small><strong>${esc(trial)}</strong></span><span><small>Billing period ends</small><strong>${esc(period)}</strong></span><span><small>Renewal</small><strong>${value.cancel_at_period_end?'Cancels at period end':'Continues automatically'}</strong></span></div>${value.has_customer?'<button class="btn primary" onclick="Settings.openBillingPortal()">Manage billing</button>':''}${billingLoading?'<p class="report-note">Refreshing billing status…</p>':''}</section><section class="card settings-section"><h2>Choose a plan</h2><p class="sub">Checkout opens on Stripe’s secure hosted page. Prices remain configurable before launch.</p><div class="billing-plans">${plans.map(([key,name,price,seats])=>`<div class="mini-row"><span><strong>${name}</strong><small>${price} · ${seats}</small></span><button class="btn small" onclick="Settings.startCheckout('${key}')">Choose</button></div>`).join('')}</div><p class="report-note">Custom plans remain available through Greenhouse Ledger support.</p></section></div>`;
  }
  async function loadBilling(){
    if(billingLoading||context().role!=='owner')return;billingLoading=true;
    const {data,error}=await LedgerAuth.client.rpc('get_organization_billing_summary',{target_organization_id:org().id});
    billingLoading=false;if(error){showToast(error.message);return;}billing=data;if(section==='billing')render();
  }
  async function startCheckout(plan){
    const {data,error}=await LedgerAuth.client.functions.invoke('create-billing-checkout',{body:{organization_id:org().id,plan}});
    if(error||!data?.url){showToast(data?.error||error?.message||'Checkout could not be started');return;}location.href=data.url;
  }
  async function openBillingPortal(){
    const {data,error}=await LedgerAuth.client.functions.invoke('create-billing-portal',{body:{organization_id:org().id}});
    if(error||!data?.url){showToast(data?.error||error?.message||'Billing management could not be opened');return;}location.href=data.url;
  }
  function aboutMarkup(){
    const contact=org().contact_email;
    return `<div class="settings-grid"><section class="card settings-section"><h2>Greenhouse Ledger</h2><p class="sub">Private inventory and greenhouse operations workspace.</p><div class="settings-facts"><span><small>Version</small><strong>1.17.0</strong></span><span><small>Product phase</small><strong>Phase 25 · Subscription billing</strong></span><span><small>Workspace role</small><strong>${esc(context().role)}</strong></span><span><small>Account mode</small><strong>${context().isDemo?'Reusable demo':'Standard workspace'}</strong></span><span><small>Support contact</small><strong>${esc(contact||'Not configured')}</strong></span></div></section><section class="card settings-section"><h2>Pilot readiness</h2><p class="sub">Before onboarding a real greenhouse, publish the support contact, privacy policy, terms of use, and pilot agreement.</p><div class="settings-facts"><span><small>Privacy policy</small><strong>Not published</strong></span><span><small>Terms of use</small><strong>Not published</strong></span><span><small>Release notes</small><strong>Phases 1–25 tracked in the Product Bible</strong></span></div></section></div>`;
  }
  function previewMarkup(p,image){
    const text=safeForeground(p.background);
    return `<div class="brand-preview" style="--brand-preview-bg:${p.background};--brand-preview-text:${text}"><div class="brand-preview-bar"><div class="brand-preview-mark">${image?`<img src="${esc(image)}" alt="">`:''}<div><strong>${esc(org().name)}</strong><small style="display:block;opacity:.72">Greenhouse Ledger</small></div></div><button class="btn small" style="background:${p.primary};border-color:${p.primary};color:${safeForeground(p.primary)}">Primary action</button></div><div class="brand-swatches"><span class="brand-swatch" style="background:${p.primary}" title="Primary"></span><span class="brand-swatch" style="background:${p.accent}" title="Accent"></span><span class="brand-swatch" style="background:${p.background}" title="Background"></span></div></div>`;
  }
  function afterRender(){if(section==='brand')preview();}
  function formPalette(){const form=document.getElementById('brand-form');return form?{primary:form.primary.value,accent:form.accent.value,background:form.background.value}:palette();}
  function preview(){const target=document.getElementById('brand-preview');if(target)target.innerHTML=previewMarkup(formPalette(),pendingLogoUrl||logoUrl);}
  function status(message,error=false){const target=document.getElementById('settings-status');if(target){target.textContent=message;target.style.color=error?'var(--danger)':'var(--moss-light)';}else showToast(message);}

  async function chooseLogo(event){
    const file=event.target.files[0];
    if(!file)return;
    if(file.size>2*1024*1024){status('Choose a logo smaller than 2 MB.',true);return;}
    if(!['image/png','image/jpeg','image/webp','image/svg+xml'].includes(file.type)){status('Choose a PNG, JPEG, WebP, or SVG logo.',true);return;}
    pendingLogo=file;
    if(pendingLogoUrl)URL.revokeObjectURL(pendingLogoUrl);
    pendingLogoUrl=URL.createObjectURL(file);
    open('brand');
    if(file.type!=='image/svg+xml'){
      try{const suggested=await extractPalette(pendingLogoUrl);const form=document.getElementById('brand-form');form.primary.value=suggested.primary;form.accent.value=suggested.accent;form.background.value=suggested.background;preview();status('Logo colors suggested. Review the preview, then publish.');}catch(error){status('Logo ready. Choose colors manually, then publish.');}
    }else status('SVG logo ready. Choose colors manually, then publish.');
  }
  function extractPalette(url){
    return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{try{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,64,64);const counts=new Map();for(let index=0;index<64*64*4;index+=16){const data=ctx.getImageData(0,0,64,64).data;const alpha=data[index+3];if(alpha<180)continue;const values=[data[index],data[index+1],data[index+2]].map(v=>Math.round(v/32)*32);const key=toHex(values);const max=Math.max(...values),min=Math.min(...values);if(max-min<18||max<25||min>235)continue;counts.set(key,(counts.get(key)||0)+1);}const colors=[...counts].sort((a,b)=>b[1]-a[1]).map(entry=>entry[0]);if(!colors.length)throw new Error('No palette');const primary=colors[0];const accent=colors.find(color=>rgb(color).reduce((sum,value,index)=>sum+Math.abs(value-rgb(primary)[index]),0)>160)||mix(primary,'#ffffff',.35);const darkest=colors.slice(0,8).sort((a,b)=>luminance(a)-luminance(b))[0];resolve({primary,accent,background:luminance(darkest)<.22?darkest:mix(darkest,'#000000',.7)});}catch(error){reject(error);}};image.onerror=reject;image.src=url;});
  }

  async function saveUsername(event){event.preventDefault();const username=String(new FormData(event.currentTarget).get('username')||'').trim().toLowerCase();const {error}=await LedgerAuth.client.from('profiles').update({username}).eq('id',context().session.user.id);if(error){showToast(error.code==='23505'?'That username is already taken.':error.message);return;}context().profile.username=username;showToast('Username updated');}
  async function saveEmail(event){event.preventDefault();const email=String(new FormData(event.currentTarget).get('email')||'').trim().toLowerCase();const {data,error}=await LedgerAuth.client.auth.updateUser({email},{emailRedirectTo:new URL('./',location.href).href});if(error){showToast(error.message);return;}showToast(data.user?.new_email?'Check your email to confirm the change':'Email updated');event.currentTarget.reset();}
  async function savePassword(event){event.preventDefault();const form=new FormData(event.currentTarget);const current=String(form.get('current')||'');const password=String(form.get('password')||'');if(password!==form.get('confirm')){showToast('New passwords do not match');return;}const verified=await LedgerAuth.client.auth.signInWithPassword({email:context().session.user.email,password:current});if(verified.error){showToast('Current password is incorrect');return;}const {error}=await LedgerAuth.client.auth.updateUser({password});if(error){showToast(error.message);return;}event.currentTarget.reset();showToast('Password changed');}

  async function saveBrand(event){
    event.preventDefault();
    const next=formPalette();
    if(contrast(next.primary,next.background)<1.35&&contrast(next.accent,next.background)<1.35){status('Choose at least one action color that stands out from the background.',true);return;}
    const organization=org();let path=organization.brand_logo_path;let oldPath=path;
    if(pendingLogo){const extension=(pendingLogo.name.split('.').pop()||'png').replace(/[^a-z0-9]/gi,'').toLowerCase();path=`${organization.id}/branding/logo-${Date.now()}.${extension}`;const uploaded=await LedgerAuth.client.storage.from('greenhouse-photos').upload(path,pendingLogo,{contentType:pendingLogo.type,upsert:false});if(uploaded.error){status(uploaded.error.message,true);return;}}
    const payload={target_organization_id:organization.id,target_brand_primary:next.primary,target_brand_accent:next.accent,target_brand_background:next.background,target_brand_logo_path:path};
    const {data,error}=await LedgerAuth.client.rpc('update_organization_branding',payload);
    if(error){if(path&&path!==oldPath)await LedgerAuth.client.storage.from('greenhouse-photos').remove([path]);status(error.message,true);return;}
    Object.assign(organization,data);if(oldPath&&path!==oldPath)await LedgerAuth.client.storage.from('greenhouse-photos').remove([oldPath]);
    if(path){const signed=await LedgerAuth.client.storage.from('greenhouse-photos').createSignedUrl(path,3600);logoUrl=signed.data?.signedUrl||pendingLogoUrl;}else logoUrl='';
    pendingLogo=null;pendingLogoUrl='';applyTheme(next);status('Branding published for your organization.');setTimeout(()=>render(),500);
  }
  async function resetBrand(){
    if(!confirm('Reset the shared logo and colors to the Greenhouse Ledger defaults?'))return;
    const oldPath=org().brand_logo_path;
    const {data,error}=await LedgerAuth.client.rpc('update_organization_branding',{target_organization_id:org().id,target_brand_primary:DEFAULTS.primary,target_brand_accent:DEFAULTS.accent,target_brand_background:DEFAULTS.background,target_brand_logo_path:null});
    if(error){status(error.message,true);return;}if(oldPath)await LedgerAuth.client.storage.from('greenhouse-photos').remove([oldPath]);Object.assign(org(),data);logoUrl='';pendingLogo=null;pendingLogoUrl='';applyTheme(DEFAULTS);render();showToast('Branding reset');
  }

  window.Settings={initialize,applyTheme,brandLogoMarkup,toggleMenu,open,render:renderMarkup,afterRender,preview,chooseLogo,saveUsername,saveEmail,savePassword,saveBrand,resetBrand,startCheckout,openBillingPortal};
})();
