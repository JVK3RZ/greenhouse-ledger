(function(){
  let overview={organizations:[],metrics:{organizations:0,active:0,trials:0,suspended:0}};
  let detail=null;
  let query='';
  let loading=false;

  const client=()=>LedgerAuth.client;
  const context=()=>LedgerAuth.getContext();
  const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const label=value=>String(value||'').replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase());
  const date=value=>value?new Date(value).toLocaleDateString():'—';
  const inputDate=value=>value?new Date(value).toISOString().slice(0,10):'';
  const statusClass=value=>['active','trialing'].includes(value)?'accepted':value==='grace_period'?'pending':'delivery_failed';

  function open(){
    if(!context()?.isPlatformAdmin)return;
    activeTab='platform';
    render();
    load();
  }

  async function load(search=query){
    if(!context()?.isPlatformAdmin)return;
    query=String(search||'').trim();
    loading=true;renderContent();
    const {data,error}=await client().rpc('get_platform_admin_overview',{search_term:query||null});
    loading=false;
    if(error){showToast(error.message);renderContent();return;}
    overview=data||overview;
    renderContent();
  }

  async function search(event){
    event.preventDefault();
    await load(new FormData(event.currentTarget).get('search'));
  }

  async function manage(organizationId){
    const {data,error}=await client().rpc('get_platform_admin_organization',{target_organization_id:organizationId});
    if(error){showToast(error.message);return;}
    detail=data;renderContent();
    document.getElementById('platform-detail')?.scrollIntoView({behavior:'smooth',block:'start'});
  }

  function closeDetail(){detail=null;renderContent();}

  function renderMarkup(){
    if(!context()?.isPlatformAdmin)return '<div class="empty">Platform administrator access required.</div>';
    const metrics=overview.metrics||{};
    return `<div class="platform-heading"><div><div class="section-label">Owner administration</div><h2>Customer access control</h2><p class="sub">Manage plans, trials, staff limits, and organization access without entering customer inventory.</p></div><span class="platform-private">Platform owner only</span></div>
      <div class="metric-grid"><div class="metric"><span>Organizations</span><strong>${Number(metrics.organizations||0)}</strong></div><div class="metric"><span>Active</span><strong>${Number(metrics.active||0)}</strong></div><div class="metric"><span>Trials</span><strong>${Number(metrics.trials||0)}</strong></div><div class="metric"><span>Suspended / ended</span><strong>${Number(metrics.suspended||0)}</strong></div></div>
      <form class="platform-search" onsubmit="PlatformAdmin.search(event)"><label>Find an organization<input name="search" maxlength="100" value="${esc(query)}" placeholder="Greenhouse or business name"></label><button class="btn primary">Search</button>${query?'<button class="btn" type="button" onclick="PlatformAdmin.clearSearch()">Clear</button>':''}</form>
      ${loading?'<div class="empty">Loading organizations…</div>':organizationList()}
      ${detail?detailMarkup():''}`;
  }

  function organizationList(){
    const organizations=overview.organizations||[];
    if(!organizations.length)return '<div class="empty">No organizations match this search.</div>';
    return `<div class="platform-list">${organizations.map(item=>`<article class="card platform-organization"><div><div class="platform-org-top"><div><h3>${esc(item.name)}</h3><p>${esc(item.owner_names||'Owner not assigned')} · created ${date(item.created_at)}</p></div><span class="status-badge status-${statusClass(item.access_status)}">${esc(label(item.access_status))}</span></div><div class="platform-facts"><span><small>Plan</small><strong>${esc(label(item.plan))}</strong></span><span><small>Members</small><strong>${Number(item.member_count||0)} / ${Number(item.staff_limit||0)}</strong></span><span><small>Pending invites</small><strong>${Number(item.pending_invitation_count||0)}</strong></span><span><small>Trial ends</small><strong>${date(item.trial_ends_at)}</strong></span></div></div><button class="btn" onclick="PlatformAdmin.manage('${esc(item.id)}')">Manage access</button></article>`).join('')}</div>`;
  }

  function detailMarkup(){
    const organization=detail.organization;
    const entitlement=detail.entitlement;
    return `<section id="platform-detail" class="card platform-detail"><div class="platform-detail-head"><div><div class="eyebrow">Organization administration</div><h2>${esc(organization.name)}</h2><p class="sub">Commercial access and staff visibility only. Customer inventory is intentionally unavailable here.</p></div><button class="btn ghost" onclick="PlatformAdmin.closeDetail()">Close</button></div>
      <div class="settings-grid"><form class="stack-form platform-entitlement" onsubmit="PlatformAdmin.saveEntitlement(event)"><h3>Plan and access</h3><label>Plan<select name="plan">${['trial','pilot','starter','growth','custom','complimentary'].map(value=>`<option value="${value}" ${entitlement.plan===value?'selected':''}>${label(value)}</option>`).join('')}</select></label><label>Access status<select name="status">${['trialing','active','grace_period','suspended','canceled'].map(value=>`<option value="${value}" ${entitlement.access_status===value?'selected':''}>${label(value)}</option>`).join('')}</select></label><div class="form-pair"><label>Trial ends<input name="trial" type="date" value="${inputDate(entitlement.trial_ends_at)}"></label><label>Billing period ends<input name="period" type="date" value="${inputDate(entitlement.current_period_end)}"></label></div><label>Staff limit<input name="staffLimit" type="number" min="1" max="10000" required value="${Number(entitlement.staff_limit)}"></label><label>Reason for this change<textarea name="reason" required minlength="3" maxlength="500" rows="3" placeholder="Required for the audit trail"></textarea></label><button class="btn primary">Save access settings</button></form>
      <div><h3>Membership summary</h3><div class="platform-members">${(detail.members||[]).map(member=>`<div class="mini-row"><span><strong>${esc(member.display_name||member.username||member.email)}</strong><small>${esc(member.email||member.username||'')}</small></span><span>${esc(label(member.role))} · ${esc(label(member.status||'active'))}<small>Joined ${date(member.joined_at)}</small></span></div>`).join('')||'<div class="empty">No members</div>'}</div><p class="report-note">Staff accounts and employee status are visible for support and seat management. Inventory records are not exposed to platform administration.</p></div></div>
      <div class="settings-grid platform-history"><form class="stack-form" onsubmit="PlatformAdmin.addNote(event)"><h3>Internal notes</h3><label>New private note<textarea name="note" required minlength="2" maxlength="2000" rows="4" placeholder="Pilot details, support context, or agreed exceptions"></textarea></label><button class="btn">Add note</button><div class="platform-timeline">${(detail.notes||[]).map(note=>`<div><strong>${esc(note.author||'Platform administrator')}</strong><small>${date(note.created_at)}</small><p>${esc(note.note)}</p></div>`).join('')||'<div class="empty">No internal notes yet.</div>'}</div></form><div><h3>Administration audit</h3><div class="platform-timeline">${(detail.audit||[]).map(entry=>`<div><strong>${esc(label(entry.action))}</strong><small>${date(entry.created_at)} · ${esc(entry.actor||'Platform administrator')}</small><p>${esc(entry.reason||'Recorded automatically')}</p></div>`).join('')||'<div class="empty">No administration changes yet.</div>'}</div></div></div></section>`;
  }

  async function saveEntitlement(event){
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    const toTimestamp=value=>value?new Date(`${value}T23:59:59.999Z`).toISOString():null;
    const payload={target_organization_id:detail.organization.id,target_plan:String(form.get('plan')),target_access_status:String(form.get('status')),target_trial_ends_at:toTimestamp(form.get('trial')),target_current_period_end:toTimestamp(form.get('period')),target_staff_limit:Number(form.get('staffLimit')),change_reason:String(form.get('reason')||'').trim()};
    const {error}=await client().rpc('update_organization_entitlement',payload);
    if(error){showToast(error.message);return;}
    showToast('Organization access updated');
    await load();await manage(detail.organization.id);
  }

  async function addNote(event){
    event.preventDefault();
    const note=String(new FormData(event.currentTarget).get('note')||'').trim();
    const {error}=await client().rpc('add_platform_admin_note',{target_organization_id:detail.organization.id,note_text:note});
    if(error){showToast(error.message);return;}
    showToast('Internal note added');
    await manage(detail.organization.id);
  }

  function clearSearch(){query='';load('');}

  window.PlatformAdmin={open,load,search,manage,closeDetail,saveEntitlement,addNote,clearSearch,render:renderMarkup};
})();
