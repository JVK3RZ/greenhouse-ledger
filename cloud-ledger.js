(function(){
  const STAGES = ['propagation','seedling','vegetative','finishing','retail_ready','dormant'];
  const emptyData = (loading=false) => ({locations:[],catalog:[],batches:[],transactions:[],counts:[],tasks:[],issues:[],members:[],invitations:[],activity:[],loading,offline:false,error:null});
  let data = emptyData();
  let loadRequest = 0;
  let inventoryTool = 'single';
  let activityFilters = {days:'30',actor:'',type:''};
  let activityVisible = 25;

  const client = () => LedgerAuth.client;
  const organizationId = () => LedgerAuth.getContext().organization.id;
  const money = value => value == null ? '—' : WorkspaceSettings.money(value);
  const label = value => String(value||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
  const option = (value,text) => `<option value="${esc(value)}">${esc(text)}</option>`;
  const activeCatalog = () => data.catalog.filter(item=>item.status!=='archived');
  const codeHint = (kind,fallback) => {const prefix=LedgerAuth.getContext().organization[kind];return prefix?`${prefix}-...`:fallback;};

  function bulkReceiptRow(){
    return `<div class="bulk-receive-row">
      <label>Product<select name="plant_catalog_id" required>${activeCatalog().map(item=>option(item.id,[item.common_name,item.container_size].filter(Boolean).join(' · '))).join('')}</select></label>
      <label>Location<select name="location_id" required>${data.locations.map(item=>option(item.id,item.name)).join('')}</select></label>
      <label>Quantity<input name="quantity" type="number" min="1" required></label>
      <label>Stage<select name="stage">${STAGES.map(stage=>option(stage,label(stage))).join('')}</select></label>
      <label>Batch code<input name="batch_code" placeholder="${esc(codeHint('batch_prefix','optional'))}"></label>
      <label>Unit cost<input name="unit_cost" type="number" min="0" step="0.01"></label>
      <label>Unit price<input name="unit_price" type="number" min="0" step="0.01"></label>
      <button class="btn ghost small" type="button" onclick="this.closest('.bulk-receive-row').remove()">Remove</button>
    </div>`;
  }

  function onboardingState(){
    const role=LedgerAuth.getContext().role;
    const steps=[
      {done:data.locations.length>0,label:'Create a production zone',tab:'setup'},
      {done:data.catalog.length>0,label:'Add a plant to the catalog',tab:'setup'},
      {done:data.batches.length>0,label:'Receive the first inventory batch',tab:'inventory'},
      {done:data.tasks.length>0,label:'Schedule the first care task',tab:'operations'},
      {done:data.members.length>1||data.invitations.length>0,label:'Invite a manager or worker',tab:'team'}
    ];
    return {role,steps,completed:steps.filter(step=>step.done).length};
  }

  function renderOwnerOnboarding(){
    const onboarding=onboardingState();
    if(onboarding.role!=='owner'||onboarding.completed===onboarding.steps.length)return '';
    const isEmpty=!data.locations.length&&!data.catalog.length&&!data.batches.length&&!data.tasks.length;
    return `<section class="onboarding-card"><div class="onboarding-head"><div><div class="eyebrow">Owner setup</div><h2>Prepare ${esc(LedgerAuth.getContext().organization.name)} for its first shift</h2><p>${onboarding.completed} of ${onboarding.steps.length} essentials complete</p></div><strong>${Math.round(onboarding.completed/onboarding.steps.length*100)}%</strong></div><div class="progress-track"><span style="width:${onboarding.completed/onboarding.steps.length*100}%"></span></div><div class="onboarding-steps">${onboarding.steps.map(step=>`<button class="onboarding-step ${step.done?'done':''}" ${step.done?'disabled':`onclick="setTab('${step.tab}')"`}><span>${step.done?'✓':'○'}</span>${esc(step.label)}</button>`).join('')}</div>${isEmpty?`<div class="demo-callout"><div><strong>Need something realistic to demonstrate?</strong><p>Load a small sample greenhouse with zones, plants, inventory, and care work. This is only available while the workspace is empty.</p></div><button class="btn primary" onclick="CloudLedger.seedDemo()">Load demo greenhouse</button></div>`:''}</section>`;
  }

  function renderMemberWelcome(){
    const context=LedgerAuth.getContext();
    const key=`greenhouse-ledger-welcome-${context.organization.id}-${context.profile.id}`;
    if(context.role==='owner'||localStorage.getItem(key)==='dismissed')return '';
    const accepted=context.acceptedInvitation;
    return `<section class="welcome-card"><button class="welcome-close" aria-label="Dismiss welcome" onclick="CloudLedger.dismissWelcome('${key}')">×</button><div class="eyebrow">${accepted?'Invitation accepted':'Team workspace'}</div><h2>${accepted?`Welcome to ${esc(accepted.organizationName)}`:`Welcome back to ${esc(context.organization.name)}`}</h2><p>You are signed in as a <strong>${esc(label(context.role))}</strong>. ${context.role==='worker'?'Start in Operations to review assigned work, then record completion from the care queue.':'You can manage daily operations, inventory, and staff invitations without changing organization ownership.'}</p><button class="btn primary small" onclick="setTab('operations')">View assigned work</button></section>`;
  }

  async function load(){
    const request=++loadRequest;
    data=emptyData(true);
    const org=organizationId();
    const [locations,catalog,batches,transactions,counts,tasks,issues,members,invitations,activity]=await Promise.all([
      client().from('locations').select('*').eq('organization_id',org).order('name'),
      client().from('plant_catalog').select('*').eq('organization_id',org).order('common_name'),
      client().from('inventory_batches').select('*, plant_catalog(*), location:locations(*)').eq('organization_id',org).order('created_at',{ascending:false}),
      client().from('inventory_transactions').select('*').eq('organization_id',org).order('created_at',{ascending:false}).limit(100),
      client().from('inventory_counts').select('*, location:locations(name), inventory_count_lines(*, batch:inventory_batches(batch_code, plant_catalog(common_name,container_size), location:locations(name)))').eq('organization_id',org).order('started_at',{ascending:false}).limit(10),
      client().from('care_tasks').select('*, assignee:profiles!care_tasks_assigned_to_fkey(display_name), location:locations(name), batch:inventory_batches(batch_code,plant_catalog(common_name))').eq('organization_id',org).order('due_at'),
      client().from('plant_health_issues').select('*, batch:inventory_batches(batch_code,plant_catalog(common_name,container_size)), location:locations(name), reporter:profiles!plant_health_issues_reported_by_fkey(display_name), plant_health_issue_updates(*, author:profiles!plant_health_issue_updates_created_by_fkey(display_name))').eq('organization_id',org).order('created_at',{ascending:false}),
      client().from('organization_members').select('profile_id,role,profile:profiles(display_name)').eq('organization_id',org),
      client().from('organization_invitations').select('*').eq('organization_id',org).order('created_at',{ascending:false}),
      client().from('activity_logs').select('*, actor:profiles(display_name)').eq('organization_id',org).order('created_at',{ascending:false}).limit(200)
    ]);
    if(request!==loadRequest||org!==organizationId())return;
    const failed=[locations,catalog,batches,transactions,counts,tasks,issues,members,invitations,activity].find(result=>result.error);
    if(failed){
      const cached=await loadData(`cloud-${org}`,null);
      if(cached){ data={...cached,loading:false,offline:true,error:'Showing the last saved cloud snapshot.'}; }
      else { data.loading=false; data.offline=true; data.error=failed.error.message; }
      return;
    }
    data={locations:locations.data||[],catalog:catalog.data||[],batches:batches.data||[],transactions:transactions.data||[],counts:counts.data||[],tasks:tasks.data||[],issues:issues.data||[],members:members.data||[],invitations:invitations.data||[],activity:activity.data||[],loading:false,offline:false,error:null};
    await saveData(`cloud-${org}`,data);
  }

  function reset(){loadRequest+=1;data=emptyData(true);activityFilters={days:'30',actor:'',type:''};activityVisible=25;}

  async function refresh(message){
    await load();
    if(typeof render==='function') render();
    if(message) showToast(message);
  }

  function renderDashboard(){
    if(data.loading) return '<div class="empty">Loading greenhouse dashboard…</div>';
    const now=new Date();
    const open=data.tasks.filter(task=>!['completed','cancelled'].includes(task.status));
    const overdue=open.filter(task=>task.due_at&&new Date(task.due_at)<now);
    const low=data.batches.filter(batch=>Number(batch.quantity)<=WorkspaceSettings.lowStockThreshold());
    const units=data.batches.reduce((sum,batch)=>sum+Number(batch.quantity||0),0);
    const nextTasks=[...open].sort((a,b)=>new Date(a.due_at||'9999-12-31')-new Date(b.due_at||'9999-12-31')).slice(0,6);
    return `${data.error?`<div class="sync-notice ${data.offline?'offline':''}">${esc(data.error)}</div>`:''}
      ${renderMemberWelcome()}${renderOwnerOnboarding()}
      <div class="metric-grid"><div class="metric"><span>${esc(label(WorkspaceSettings.quantityLabel()))} on hand</span><strong>${units}</strong></div><div class="metric"><span>Production zones</span><strong>${data.locations.length}</strong></div><div class="metric"><span>Open tasks</span><strong>${open.length}</strong></div><div class="metric"><span>Overdue</span><strong>${overdue.length}</strong></div></div>
      ${low.length?`<div class="sync-notice offline"><strong>Low stock:</strong> ${low.map(batch=>esc(`${batch.plant_catalog?.common_name||'Unknown'} (${batch.quantity})`)).join(' · ')}</div>`:''}
      <div class="section-label">Next work</div>
      ${nextTasks.length?nextTasks.map(task=>`<div class="today-item"><div><strong>${esc(task.title)}</strong><div class="today-space">${esc(task.location?.name||'All production zones')} · ${task.due_at?new Date(task.due_at).toLocaleString():'No due date'} · ${esc(task.assignee?.display_name||'Unassigned')}</div></div><button class="btn primary small" onclick="CloudLedger.completeTask('${task.id}')">Complete</button></div>`).join(''):'<div class="empty">No open work. Create a care task from Operations.</div>'}
      <div class="section-label">Recent activity</div>
      ${data.activity.slice(0,8).map(item=>`<div class="mini-row"><span><strong>${esc(label(item.action))}</strong><small>${esc(item.actor?.display_name||'System')} · ${esc(label(item.entity_type))}</small></span><small>${new Date(item.created_at).toLocaleString()}</small></div>`).join('')||'<div class="empty">No business activity yet.</div>'}`;
  }

  function filteredActivity(){
    const cutoff=activityFilters.days==='all'?null:Date.now()-Number(activityFilters.days)*86400000;
    return data.activity.filter(item=>(!cutoff||new Date(item.created_at).getTime()>=cutoff)&&(!activityFilters.actor||item.actor_id===activityFilters.actor)&&(!activityFilters.type||item.entity_type===activityFilters.type));
  }

  function activityHistory(){
    const actors=[...new Map(data.activity.filter(item=>item.actor_id).map(item=>[item.actor_id,item.actor?.display_name||'Unnamed staff member'])).entries()];
    const types=[...new Set(data.activity.map(item=>item.entity_type).filter(Boolean))].sort();
    const matches=filteredActivity();const items=matches.slice(0,activityVisible);const remaining=Math.max(0,matches.length-items.length);
    return `<div class="activity-filter"><label>Time period<select onchange="CloudLedger.filterActivity('days',this.value)"><option value="7" ${activityFilters.days==='7'?'selected':''}>Last 7 days</option><option value="30" ${activityFilters.days==='30'?'selected':''}>Last 30 days</option><option value="90" ${activityFilters.days==='90'?'selected':''}>Last 90 days</option><option value="all" ${activityFilters.days==='all'?'selected':''}>All loaded activity</option></select></label><label>Staff member<select onchange="CloudLedger.filterActivity('actor',this.value)"><option value="">Everyone</option>${actors.map(([id,name])=>`<option value="${esc(id)}" ${activityFilters.actor===id?'selected':''}>${esc(name)}</option>`).join('')}</select></label><label>Record type<select onchange="CloudLedger.filterActivity('type',this.value)"><option value="">All activity</option>${types.map(type=>`<option value="${esc(type)}" ${activityFilters.type===type?'selected':''}>${esc(label(type))}</option>`).join('')}</select></label></div><p class="report-note">Activity history is preserved for accountability. Filters change this view without deleting records. Showing ${items.length} of ${matches.length} matching records.</p>${items.map(a=>`<div class="mini-row"><span><strong>${esc(label(a.action))}</strong><small>${esc(a.actor?.display_name||'System')} · ${esc(label(a.entity_type))}</small></span><small>${new Date(a.created_at).toLocaleString()}</small></div>`).join('')||'<div class="empty">No activity matches these filters.</div>'}${remaining?`<div class="activity-more"><button class="btn" type="button" onclick="CloudLedger.showMoreActivity()">Show ${Math.min(25,remaining)} more</button><small>${remaining} remaining</small></div>`:''}`;
  }

  function renderInventory(){
    if(data.loading) return '<div class="empty">Loading greenhouse inventory…</div>';
    const total=data.batches.reduce((sum,batch)=>sum+batch.quantity,0);
    const retail=data.batches.filter(batch=>batch.stage==='retail_ready').reduce((sum,batch)=>sum+batch.quantity,0);
    const openCount=data.counts.find(count=>count.status==='draft');
    const canApprove=['owner','manager'].includes(LedgerAuth.getContext().role);
    const canCorrect=canApprove;
    const counted=openCount?.inventory_count_lines.filter(line=>line.counted_quantity!==null).length||0;
    const countLines=openCount?.inventory_count_lines||[];
    return `
      ${data.error?`<div class="sync-notice ${data.offline?'offline':''}">${esc(data.error)}</div>`:''}
      <div class="metric-grid">
        <div class="metric"><span>${esc(label(WorkspaceSettings.quantityLabel()))} on hand</span><strong>${total}</strong></div>
        <div class="metric"><span>Active batches</span><strong>${data.batches.length}</strong></div>
        <div class="metric"><span>Retail ready</span><strong>${retail}</strong></div>
        <div class="metric"><span>Locations</span><strong>${data.locations.length}</strong></div>
      </div>
      <div class="section-label">Inventory tools</div>
      <div class="inventory-tools">
        <button class="${inventoryTool==='single'?'active':''}" onclick="CloudLedger.setInventoryTool('single')"><span>＋</span><strong>Receive one batch</strong><small>Add one incoming product.</small></button>
        <button class="${inventoryTool==='bulk'?'active':''}" onclick="CloudLedger.setInventoryTool('bulk')"><span>▦</span><strong>Bulk receiving</strong><small>Receive several batches together.</small></button>
        <button class="${inventoryTool==='count'?'active':''}" onclick="CloudLedger.setInventoryTool('count')"><span>✓</span><strong>Physical stock count</strong><small>Compare the shelf to the ledger.</small></button>
      </div>
      ${inventoryTool==='single'?`<div class="section-label">Receive one batch</div>
      ${activeCatalog().length&&data.locations.length?`
        <form class="ops-form" onsubmit="CloudLedger.addBatch(event)">
          <label>Product<select name="plant_catalog_id" required>${activeCatalog().map(item=>option(item.id,[item.common_name,item.container_size].filter(Boolean).join(' · '))).join('')}</select></label>
          <label>Location<select name="location_id" required>${data.locations.map(item=>option(item.id,item.name)).join('')}</select></label>
          <label>Quantity<input name="quantity" type="number" min="1" required></label>
          <label>Stage<select name="stage">${STAGES.map(stage=>option(stage,label(stage))).join('')}</select></label>
          <label>Batch code<input name="batch_code" placeholder="${esc(codeHint('batch_prefix','optional'))}"></label>
          <label>Unit cost<input name="unit_cost" type="number" min="0" step="0.01"></label>
          <label>Unit price<input name="unit_price" type="number" min="0" step="0.01"></label>
          <button class="btn primary" type="submit">Receive batch</button>
        </form>`:
        `<div class="empty">Add at least one location and one active catalog product before receiving inventory.</div>`}`:''}
      ${inventoryTool==='bulk'?`<div class="section-label">Bulk receiving</div>
        ${activeCatalog().length&&data.locations.length?`<form class="bulk-receive-form" onsubmit="CloudLedger.bulkReceive(event)"><p class="report-note">Add every incoming batch, then save once. If any row is invalid, none of the receipt is posted.</p><div class="bulk-receive-rows">${bulkReceiptRow()}</div><div class="card-actions"><button class="btn" type="button" onclick="CloudLedger.addBulkRow()">Add another batch</button><button class="btn primary" type="submit">Receive all batches</button></div></form>`:'<div class="empty">Add a production zone and active catalog product before bulk receiving.</div>'}`:''}
      ${inventoryTool==='count'?`<div class="section-label">Physical stock count</div>
        ${openCount?`<section class="count-sheet"><div class="count-head"><div><h2>${esc(openCount.location?.name||'All locations')}</h2><p>${counted} of ${countLines.length} batches counted · expected quantities stay unchanged until approval.</p></div><span class="status-badge status-pending">In progress</span></div>
          <div class="count-lines">${countLines.map(line=>{const variance=line.counted_quantity===null?null:Number(line.counted_quantity)-Number(line.expected_quantity);return `<form class="count-line" onsubmit="CloudLedger.saveCountLine(event,'${openCount.id}','${line.batch_id}')"><div><strong>${esc(line.batch?.plant_catalog?.common_name||'Unknown product')}</strong><small>${esc(line.batch?.location?.name||'Unassigned')} · ${esc(line.batch?.batch_code||'No batch code')}</small></div><span>Expected <b>${line.expected_quantity}</b></span><label>Counted<input name="physical_quantity" type="number" min="0" value="${line.counted_quantity??''}" required></label><button class="btn small" type="submit">Save</button><em class="${variance===0?'count-even':variance===null?'':'count-difference'}">${variance===null?'Not counted':variance===0?'Matches':`${variance>0?'+':''}${variance} difference`}</em></form>`}).join('')}</div>
          <div class="card-actions">${canApprove?`<button class="btn ghost" onclick="CloudLedger.cancelCount('${openCount.id}')">Cancel count</button><button class="btn primary" onclick="CloudLedger.finalizeCount('${openCount.id}')" ${counted!==countLines.length?'disabled':''}>Approve adjustments</button>`:'<span class="report-note">A manager or owner approves the final adjustments.</span>'}</div>
        </section>`:`${data.batches.length?`<form class="ops-form count-start" onsubmit="CloudLedger.startCount(event)"><label>Count area<select name="location_id"><option value="">All locations</option>${data.locations.map(item=>option(item.id,item.name)).join('')}</select></label><label>Count note<input name="notes" placeholder="e.g. Friday closing count"></label><button class="btn primary" type="submit">Start physical count</button></form>`:'<div class="empty">Receive inventory before starting a physical count.</div>'}
        ${data.counts.filter(count=>count.status!=='draft').length?`<div class="section-label">Recent counts</div>${data.counts.filter(count=>count.status!=='draft').slice(0,5).map(count=>`<div class="mini-row"><span><strong>${esc(count.location?.name||'All locations')}</strong><small>${esc(label(count.status))} · ${new Date(count.started_at).toLocaleString()}</small></span><small>${count.inventory_count_lines.length} batches</small></div>`).join('')}`:''}`}`:''}
      <div class="section-label">Current batches</div>
      ${data.batches.length?data.batches.map(batch=>`
        <div class="card inventory-card">
          <div class="card-top"><div><div class="plant-name">${esc(batch.plant_catalog.common_name)}</div><div class="plant-species">${esc(batch.location?.name||'Unassigned')} · ${esc(label(batch.stage))}${batch.batch_code?` · ${esc(batch.batch_code)}`:''}</div></div><div class="stock-count">${batch.quantity}<small>${esc(WorkspaceSettings.quantityLabel())}</small></div></div>
          <div class="due-row"><div class="due-chip due-ok">Cost ${money(batch.unit_cost)}</div><div class="due-chip due-ok">Price ${money(batch.unit_price)}</div></div>
          <div class="card-actions"><label class="btn small photo-label">${batch.photo_path?'Replace photo':'Add photo'}<input type="file" accept="image/jpeg,image/png,image/webp" onchange="CloudLedger.uploadBatchPhoto(event,'${batch.id}')"></label>${canCorrect?`<details class="record-editor"><summary class="btn small">Edit batch details</summary><form class="record-edit-form" onsubmit="CloudLedger.correctBatch(event,'${batch.id}')"><label>Production zone<select name="location_id"><option value="">Unassigned</option>${data.locations.map(location=>`<option value="${esc(location.id)}" ${batch.location_id===location.id?'selected':''}>${esc(location.name)}</option>`).join('')}</select></label><label>Stage<select name="stage">${STAGES.map(stage=>`<option value="${stage}" ${batch.stage===stage?'selected':''}>${esc(label(stage))}</option>`).join('')}</select></label><label>Batch code<input name="batch_code" value="${esc(batch.batch_code||'')}"></label><label>Unit cost<input name="unit_cost" type="number" min="0" step="0.01" value="${batch.unit_cost??''}"></label><label>Unit price<input name="unit_price" type="number" min="0" step="0.01" value="${batch.unit_price??''}"></label><label>Acquired on<input name="acquired_on" type="date" value="${esc(batch.acquired_on||'')}"></label><label class="editor-notes">Notes<textarea name="notes" rows="2">${esc(batch.notes||'')}</textarea></label><div class="editor-guidance">Quantity is protected. Use stock adjustments or a physical count to correct it.</div><button class="btn primary" type="submit">Save correction</button></form></details>`:''}</div>
          <form class="adjust-form" onsubmit="CloudLedger.adjustStock(event,'${batch.id}')">
            <select name="transaction_type"><option value="received">Receive</option><option value="sale">Sale</option><option value="loss">Loss</option><option value="propagation">Propagation</option><option value="adjustment_in">Correction +</option><option value="adjustment_out">Correction −</option></select>
            <input name="quantity" type="number" min="1" placeholder="Qty" required>
            <input name="note" placeholder="Reason or reference">
            <button class="btn small" type="submit">Update stock</button>
          </form>
        </div>`).join(''):'<div class="empty">No inventory batches yet.</div>'}
    `;
  }

  function renderSetup(){
    return `
      ${data.error?`<div class="sync-notice ${data.offline?'offline':''}">${esc(data.error)}</div>`:''}
      <div class="ops-columns">
        <section><div class="section-label">Production zones</div>
          <form class="stack-form" onsubmit="CloudLedger.addLocation(event)"><input name="name" placeholder="e.g. House 1 · Bench A" required><select name="location_type"><option>greenhouse</option><option>room</option><option>zone</option><option>bench</option><option>retail</option></select><input name="notes" placeholder="Notes (optional)"><button class="btn primary" type="submit">Add location</button></form>
          ${data.locations.map(location=>`<div class="mini-row"><span><strong>${esc(location.name)}</strong><small>${esc(label(location.location_type))}</small></span></div>`).join('')||'<div class="empty">No locations yet.</div>'}
        </section>
        <section><div class="section-label">Add one product</div>
          <form class="stack-form catalog-manual-form" onsubmit="CloudLedger.addCatalogPlant(event)"><input name="common_name" placeholder="Common name — e.g. Golden Pothos" required><input name="scientific_name" placeholder="Scientific name (optional)"><input name="cultivar" placeholder="Cultivar (optional)"><input name="container_size" placeholder="Container size — e.g. 4-inch pot"><input name="sku" placeholder="${esc(codeHint('sku_prefix','Product code / SKU (optional)'))}"><input name="default_price" type="number" min="0" step="0.01" placeholder="Default selling price"><div class="form-pair"><input name="watering_days" type="number" min="1" placeholder="Water every __ days"><input name="feeding_days" type="number" min="1" placeholder="Feed every __ days"></div><button class="btn primary" type="submit">Add product</button></form>
          <p class="report-note">A SKU is simply the business's internal product code. It can be left blank.</p>
        </section>
      </div>`;
  }

  function renderOperations(){
    const now=new Date(); const open=data.tasks.filter(t=>!['completed','cancelled'].includes(t.status));
    const overdue=open.filter(t=>t.due_at&&new Date(t.due_at)<now); const low=data.batches.filter(b=>b.quantity<=WorkspaceSettings.lowStockThreshold());
    const activeIssues=data.issues.filter(issue=>issue.status!=='resolved');
    const memberOptions='<option value="">Unassigned</option>'+data.members.map(m=>option(m.profile_id,m.profile?.display_name||m.profile_id.slice(0,8))).join('');
    return `${data.error?`<div class="sync-notice ${data.offline?'offline':''}">${esc(data.error)}</div>`:''}
      <div class="metric-grid"><div class="metric"><span>Open tasks</span><strong>${open.length}</strong></div><div class="metric"><span>Overdue</span><strong>${overdue.length}</strong></div><div class="metric"><span>Low stock</span><strong>${low.length}</strong></div><div class="metric"><span>Open plant issues</span><strong>${activeIssues.length}</strong></div></div>
      ${low.length?`<div class="sync-notice offline"><strong>Low stock:</strong> ${low.map(b=>esc(`${b.plant_catalog.common_name} (${b.quantity})`)).join(' · ')}</div>`:''}
      <div class="section-label">Plant health &amp; issues</div>
      ${data.batches.length||data.locations.length?`<form class="issue-report-form" onsubmit="CloudLedger.reportIssue(event)">
        <div class="issue-form-head"><div><strong>Report an observation</strong><small>Record pests, disease, damage, or growing-condition concerns for the team to follow.</small></div></div>
        <label>Title<input name="title" maxlength="120" placeholder="e.g. Aphids on lower leaves" required></label>
        <label>Type<select name="issue_type"><option value="pest">Pest</option><option value="disease">Disease</option><option value="damage">Damage</option><option value="environmental">Environmental</option><option value="other">Other</option></select></label>
        <label>Severity<select name="severity"><option value="low">Low</option><option value="moderate" selected>Moderate</option><option value="high">High</option><option value="critical">Critical</option></select></label>
        <label>Batch<select name="batch_id"><option value="">No specific batch</option>${data.batches.map(b=>option(b.id,[b.plant_catalog?.common_name,b.batch_code].filter(Boolean).join(' · '))).join('')}</select></label>
        <label>Production zone<select name="location_id"><option value="">No specific zone</option>${data.locations.map(l=>option(l.id,l.name)).join('')}</select></label>
        <label class="issue-description">What did you observe?<textarea name="description" maxlength="2000" rows="2" placeholder="Symptoms, affected area, and any immediate action"></textarea></label>
        <label class="btn small photo-label">Add photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp"></label>
        <button class="btn primary" type="submit">Report issue</button>
      </form>`:'<div class="empty">Add a production zone or receive a batch before reporting a plant-health issue.</div>'}
      <div class="issue-list">${data.issues.length?data.issues.map(issue=>{
        const updates=[...(issue.plant_health_issue_updates||[])].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
        const subject=[issue.batch?.plant_catalog?.common_name,issue.batch?.batch_code,issue.location?.name].filter(Boolean).join(' · ')||'Greenhouse';
        return `<article class="issue-card severity-${issue.severity}"><div class="issue-card-top"><div><div class="issue-badges"><span class="status-badge status-${issue.status}">${esc(label(issue.status))}</span><span class="severity-badge">${esc(label(issue.severity))} severity</span></div><h3>${esc(issue.title)}</h3><p>${esc(label(issue.issue_type))} · ${esc(subject)} · reported by ${esc(issue.reporter?.display_name||'Staff')} ${new Date(issue.created_at).toLocaleString()}</p></div>${issue.photo_path?'<span class="photo-attached">Photo attached</span>':''}</div>${issue.description?`<div class="issue-description-text">${esc(issue.description)}</div>`:''}
          <div class="issue-history">${updates.slice(0,3).map(update=>`<div><strong>${esc(label(update.status))}</strong><span>${esc(update.note)}</span><small>${esc(update.author?.display_name||'Staff')} · ${new Date(update.created_at).toLocaleString()}</small></div>`).join('')}</div>
          <form class="issue-update-form" onsubmit="CloudLedger.updateIssue(event,'${issue.id}')"><select name="status"><option value="open" ${issue.status==='open'?'selected':''}>Open</option><option value="monitoring" ${issue.status==='monitoring'?'selected':''}>Monitoring</option><option value="resolved" ${issue.status==='resolved'?'selected':''}>Resolved</option></select><input name="note" minlength="2" maxlength="2000" placeholder="Add treatment or follow-up note" required><button class="btn ${issue.status==='resolved'?'':'primary'} small" type="submit">Save follow-up</button></form></article>`;
      }).join(''):'<div class="empty">No plant-health issues reported.</div>'}</div>
      <div class="section-label">Create care task</div>
      <form class="ops-form" onsubmit="CloudLedger.addTask(event)"><label>Title<input name="title" required placeholder="Water House 1"></label><label>Type<select name="task_type"><option>watering</option><option>feeding</option><option>inspection</option><option>repotting</option><option>pest_control</option><option>other</option></select></label><label>Due<input name="due_at" type="datetime-local" required></label><label>Assign<select name="assigned_to">${memberOptions}</select></label><label>Location<select name="location_id"><option value="">Any location</option>${data.locations.map(l=>option(l.id,l.name)).join('')}</select></label><label>Repeat days<input name="recurrence_days" type="number" min="1" placeholder="optional"></label><label>Notes<input name="notes"></label><button class="btn primary">Create task</button></form>
      <div class="section-label">Care queue</div>${open.length?open.map(t=>`<div class="today-item"><div><strong>${esc(t.title)}</strong><div class="today-space">${esc(t.location?.name||'All locations')} · ${t.due_at?new Date(t.due_at).toLocaleString():'No due date'} · ${esc(t.assignee?.display_name||'Unassigned')}${t.recurrence_days?` · repeats ${t.recurrence_days}d`:''}</div></div><button class="btn primary small" onclick="CloudLedger.completeTask('${t.id}')">Complete</button></div>`).join(''):'<div class="empty">No open care tasks.</div>'}
      <div class="section-label">Activity history</div>${activityHistory()}`;
  }

  function renderTeam(){
    const canManage=['owner','manager'].includes(LedgerAuth.getContext().role);
    const demo=LedgerAuth.getContext().isDemo===true;
    function invitationDeliveryMessage(error){
      const detail=String(error||'');
      if(/can only send testing emails|verify a domain/i.test(detail)) return 'Email could not be delivered because a sending domain has not been verified yet. Copy and share the invitation link instead.';
      return 'Email could not be delivered. Copy and share the invitation link, or try sending it again later.';
    }
    const status=i=>i.accepted_at?'accepted':i.revoked_at?'revoked':new Date(i.expires_at)<=new Date()?'expired':i.delivery_status==='failed'?'delivery_failed':i.sent_at?'emailed':'pending';
    const invitations=data.invitations.map(i=>{
      const state=status(i); const active=['pending','emailed','delivery_failed'].includes(state);
      return `<div class="card invite-card"><div class="card-top"><div><strong>${esc(i.email)}</strong><div class="plant-species">${esc(label(i.role))} · created ${new Date(i.created_at).toLocaleDateString()} · expires ${new Date(i.expires_at).toLocaleDateString()}</div></div><span class="status-badge status-${state}">${esc(label(state))}</span></div>${i.delivery_error?`<p class="report-note invitation-delivery-note">${esc(invitationDeliveryMessage(i.delivery_error))}</p>`:''}<div class="card-actions">${active?`<button class="btn small" onclick="CloudLedger.copyInvite('${i.code}')">Copy link</button>${demo?'':`<button class="btn primary small" onclick="CloudLedger.sendInvite('${i.id}')">${i.sent_at?'Resend email':'Send email'}</button>`}<button class="btn ghost small" onclick="CloudLedger.revokeInvite('${i.id}')">Revoke</button>`:''}${state==='expired'?`<button class="btn small" onclick="CloudLedger.replaceInvite('${i.id}')">Create replacement</button>`:''}</div></div>`;
    }).join('');
    return `<div class="team-heading"><div><div class="section-label">Team &amp; Invitations</div><p class="sub">Manage access to ${esc(LedgerAuth.getContext().organization.name)}. Invitations are single-use, email-locked, and expire after seven days.</p></div></div><div class="metric-grid"><div class="metric"><span>Active members</span><strong>${data.members.length}</strong></div><div class="metric"><span>Pending invites</span><strong>${data.invitations.filter(i=>['pending','emailed','delivery_failed'].includes(status(i))).length}</strong></div><div class="metric"><span>Accepted</span><strong>${data.invitations.filter(i=>status(i)==='accepted').length}</strong></div><div class="metric"><span>Expired / revoked</span><strong>${data.invitations.filter(i=>['expired','revoked'].includes(status(i))).length}</strong></div></div><div class="section-label">Active members</div>${data.members.map(m=>`<div class="mini-row"><span><strong>${esc(m.profile?.display_name||'Unnamed staff member')}</strong><small>${esc(label(m.role))}</small></span></div>`).join('')}
      ${canManage?`<div class="section-label">Create invitation</div>${demo?'<div class="sync-notice"><strong>Demo mode:</strong> invitation email delivery is disabled. You can still demonstrate creation and lifecycle tracking with a private link.</div>':''}<form class="ops-form invite-form" onsubmit="CloudLedger.inviteStaff(event)"><label>Email address<input name="email" type="email" autocomplete="email" required></label><label>Role<select name="role"><option value="worker">Worker</option><option value="manager">Manager</option></select></label><label>Delivery<select name="delivery">${demo?'<option value="link">Create link only</option>':'<option value="email">Send by email</option><option value="link">Create link only</option>'}</select></label><button class="btn primary">Create invitation</button></form><p class="report-note">Managers can operate the greenhouse and invite staff. Workers can complete assigned work. Ownership cannot be granted through an invitation.</p><div class="section-label">Invitation activity</div>${invitations||'<div class="empty">No invitations yet.</div>'}`:'<div class="sync-notice">Only owners and managers can create or manage invitations.</div>'}`;
  }

  async function addLocation(event){
    event.preventDefault(); const form=new FormData(event.currentTarget);
    const payload={organization_id:organizationId(),name:String(form.get('name')).trim(),location_type:form.get('location_type'),notes:String(form.get('notes')||'').trim()||null};
    const {error}=await client().from('locations').insert(payload); if(error)return showToast(error.message); await refresh('Location added');
  }
  async function addCatalogPlant(event){
    event.preventDefault(); const form=new FormData(event.currentTarget);
    const number=name=>form.get(name)?Number(form.get(name)):null;
    const payload={organization_id:organizationId(),common_name:String(form.get('common_name')).trim(),scientific_name:String(form.get('scientific_name')||'').trim()||null,cultivar:String(form.get('cultivar')||'').trim()||null,container_size:String(form.get('container_size')||'').trim()||null,sku:String(form.get('sku')||'').trim()||null,default_price:number('default_price'),watering_days:number('watering_days'),feeding_days:number('feeding_days'),status:'active'};
    const {error}=await client().from('plant_catalog').insert(payload); if(error)return showToast(error.message); await refresh('Catalog plant added');
  }
  async function addBatch(event){
    event.preventDefault(); const form=new FormData(event.currentTarget); const quantity=Number(form.get('quantity'));
    const payload={target_organization_id:organizationId(),target_plant_catalog_id:form.get('plant_catalog_id'),target_location_id:form.get('location_id'),starting_quantity:quantity,target_stage:form.get('stage'),target_batch_code:String(form.get('batch_code')||'').trim()||null,target_unit_cost:form.get('unit_cost')?Number(form.get('unit_cost')):null,target_unit_price:form.get('unit_price')?Number(form.get('unit_price')):null};
    const {error}=await client().rpc('receive_inventory_batch',payload); if(error)return showToast(error.message); await refresh('Inventory batch received');
  }
  async function adjustStock(event,batchId){
    event.preventDefault(); const form=new FormData(event.currentTarget); let kind=form.get('transaction_type'); let delta=Number(form.get('quantity')); if(['sale','loss','adjustment_out'].includes(kind))delta*=-1; if(kind.startsWith('adjustment_'))kind='adjustment';
    const {error}=await client().rpc('adjust_inventory_stock',{target_batch_id:batchId,stock_delta:delta,kind,stock_note:String(form.get('note')||'').trim()||null}); if(error)return showToast(error.message); await refresh('Stock updated');
  }
  async function correctBatch(event,batchId){event.preventDefault();const form=new FormData(event.currentTarget);const value=name=>String(form.get(name)||'').trim();const number=name=>value(name)===''?null:Number(value(name));const {error}=await client().rpc('correct_inventory_batch',{target_batch_id:batchId,target_location_id:value('location_id')||null,target_stage:value('stage'),target_batch_code:value('batch_code')||null,target_unit_cost:number('unit_cost'),target_unit_price:number('unit_price'),target_acquired_on:value('acquired_on')||null,target_notes:value('notes')||null});if(error)return showToast(error.message);await refresh('Batch details corrected');}
  function filterActivity(name,value){activityFilters[name]=value;activityVisible=25;render();}
  function showMoreActivity(){activityVisible+=25;render();}
  function setInventoryTool(tool){inventoryTool=tool;render();}
  function addBulkRow(){document.querySelector('.bulk-receive-rows')?.insertAdjacentHTML('beforeend',bulkReceiptRow());}
  async function bulkReceive(event){
    event.preventDefault();
    const items=[...event.currentTarget.querySelectorAll('.bulk-receive-row')].map(row=>{
      const form=new FormData(); row.querySelectorAll('input,select').forEach(field=>form.set(field.name,field.value));
      return {plant_catalog_id:form.get('plant_catalog_id'),location_id:form.get('location_id'),quantity:Number(form.get('quantity')),stage:form.get('stage'),batch_code:String(form.get('batch_code')||'').trim()||null,unit_cost:form.get('unit_cost')||null,unit_price:form.get('unit_price')||null};
    });
    if(!items.length)return showToast('Add at least one batch to the receipt');
    const {error}=await client().rpc('bulk_receive_inventory',{target_organization_id:organizationId(),receipt_items:items});
    if(error)return showToast(error.message); await refresh(`${items.length} batches received`);
  }
  async function startCount(event){event.preventDefault();const form=new FormData(event.currentTarget);const {error}=await client().rpc('start_inventory_count',{target_organization_id:organizationId(),target_location_id:form.get('location_id')||null,count_notes:String(form.get('notes')||'').trim()||null});if(error)return showToast(error.message);await refresh('Physical count started');}
  async function saveCountLine(event,countId,batchId){event.preventDefault();const form=new FormData(event.currentTarget);const {error}=await client().rpc('record_inventory_count',{target_count_id:countId,target_batch_id:batchId,physical_quantity:Number(form.get('physical_quantity'))});if(error)return showToast(error.message);await refresh('Count saved');}
  async function finalizeCount(id){if(!confirm('Approve this count and adjust the ledger to the physical quantities?'))return;const {error}=await client().rpc('finalize_inventory_count',{target_count_id:id});if(error)return showToast(error.message);await refresh('Physical count approved and inventory adjusted');}
  async function cancelCount(id){if(!confirm('Cancel this physical count? No inventory quantities will change.'))return;const {error}=await client().rpc('cancel_inventory_count',{target_count_id:id});if(error)return showToast(error.message);await refresh('Physical count cancelled');}

  async function reportIssue(event){
    event.preventDefault(); const form=new FormData(event.currentTarget); const batchId=form.get('batch_id')||null; const locationId=form.get('location_id')||null;
    if(!batchId&&!locationId)return showToast('Choose a batch or production zone');
    const {data:issueId,error}=await client().rpc('report_plant_health_issue',{target_organization_id:organizationId(),target_batch_id:batchId,target_location_id:locationId,target_issue_type:form.get('issue_type'),target_severity:form.get('severity'),target_title:String(form.get('title')).trim(),target_description:String(form.get('description')||'').trim()||null});
    if(error)return showToast(error.message);
    const file=form.get('photo');
    if(file?.size){
      const path=`${organizationId()}/issues/${issueId}/${crypto.randomUUID()}-${file.name.replace(/[^a-z0-9._-]/gi,'_')}`;
      const uploaded=await client().storage.from('greenhouse-photos').upload(path,file);
      if(uploaded.error){await refresh('Issue saved, but the photo could not be uploaded');return;}
      const attached=await client().rpc('set_plant_health_issue_photo',{target_issue_id:issueId,target_photo_path:path});
      if(attached.error){await client().storage.from('greenhouse-photos').remove([path]);await refresh('Issue saved, but the photo could not be attached');return;}
    }
    await refresh('Plant-health issue reported');
  }
  async function updateIssue(event,id){event.preventDefault();const form=new FormData(event.currentTarget);const {error}=await client().rpc('update_plant_health_issue',{target_issue_id:id,target_status:form.get('status'),update_note:String(form.get('note')).trim()});if(error)return showToast(error.message);await refresh(form.get('status')==='resolved'?'Plant-health issue resolved':'Plant-health follow-up saved');}

  async function addTask(event){event.preventDefault();const f=new FormData(event.currentTarget);const payload={organization_id:organizationId(),title:String(f.get('title')).trim(),task_type:f.get('task_type'),due_at:new Date(f.get('due_at')).toISOString(),assigned_to:f.get('assigned_to')||null,location_id:f.get('location_id')||null,recurrence_days:f.get('recurrence_days')?Number(f.get('recurrence_days')):null,notes:String(f.get('notes')||'').trim()||null};const {error}=await client().from('care_tasks').insert(payload);if(error)return showToast(error.message);await refresh('Care task created');}
  async function completeTask(id){const {error}=await client().rpc('complete_care_task',{target_task_id:id});if(error)return showToast(error.message);await refresh('Task completed');}
  async function seedDemo(){
    if(!confirm('Load sample greenhouse data into this empty workspace?'))return;
    const {error}=await client().rpc('seed_demo_organization',{target_organization_id:organizationId()});
    if(error)return showToast(error.message);
    await refresh('Demo greenhouse loaded');
  }
  function dismissWelcome(key){localStorage.setItem(key,'dismissed');render();}
  async function inviteStaff(event){event.preventDefault();const f=new FormData(event.currentTarget);const payload={organization_id:organizationId(),email:String(f.get('email')).trim().toLowerCase(),role:f.get('role')};const {data:invitation,error}=await client().from('organization_invitations').insert(payload).select().single();if(error)return showToast(error.message);if(f.get('delivery')==='email')await sendInvite(invitation.id);else{await refresh('Invitation link created');await copyInvite(invitation.code);}}
  async function copyInvite(code){const url=new URL(location.href);url.searchParams.set('invite',code);await navigator.clipboard.writeText(url.toString());showToast('Invitation link copied');}
  async function sendInvite(id,refreshAfter=true){if(LedgerAuth.getContext().isDemo)return showToast('Invitation email is disabled in demo mode. Copy the private link instead.');const {data:{session}}=await client().auth.getSession();const response=await fetch(`${window.GREENHOUSE_SUPABASE.url}/functions/v1/send-organization-invitation`,{method:'POST',headers:{'Content-Type':'application/json','apikey':window.GREENHOUSE_SUPABASE.publishableKey,'Authorization':`Bearer ${session.access_token}`},body:JSON.stringify({invitation_id:id})});const payload=await response.json().catch(()=>({}));if(!response.ok){showToast(payload.error||'Email delivery is not configured yet. Copy the invitation link instead.');if(refreshAfter)await refresh();return;}await refresh('Invitation email sent');}
  async function revokeInvite(id){if(!confirm('Revoke this invitation? Its link will stop working immediately.'))return;const {error}=await client().rpc('revoke_organization_invitation',{target_invitation_id:id});if(error)return showToast(error.message);await refresh('Invitation revoked');}
  async function replaceInvite(id){const original=data.invitations.find(i=>i.id===id);if(!original)return;const {data:replacement,error}=await client().from('organization_invitations').insert({organization_id:organizationId(),email:original.email,role:original.role}).select().single();if(error)return showToast(error.message);await refresh('Replacement invitation created');await copyInvite(replacement.code);}
  async function uploadBatchPhoto(event,batchId){const file=event.target.files[0];if(!file)return;const path=`${organizationId()}/batches/${batchId}/${crypto.randomUUID()}-${file.name.replace(/[^a-z0-9._-]/gi,'_')}`;const uploaded=await client().storage.from('greenhouse-photos').upload(path,file);if(uploaded.error)return showToast(uploaded.error.message);const {error}=await client().rpc('set_inventory_batch_photo',{target_batch_id:batchId,target_photo_path:path});if(error){await client().storage.from('greenhouse-photos').remove([path]);return showToast(error.message);}await refresh('Batch photo uploaded');}

  window.CloudLedger={load,reset,renderDashboard,renderInventory,renderSetup,renderOperations,renderTeam,addLocation,addCatalogPlant,addBatch,adjustStock,correctBatch,filterActivity,showMoreActivity,setInventoryTool,addBulkRow,bulkReceive,startCount,saveCountLine,finalizeCount,cancelCount,reportIssue,updateIssue,addTask,completeTask,seedDemo,dismissWelcome,inviteStaff,copyInvite,sendInvite,revokeInvite,replaceInvite,uploadBatchPhoto,getData:()=>data};
})();
