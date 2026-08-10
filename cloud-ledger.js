(function(){
  const STAGES = ['propagation','seedling','vegetative','finishing','retail_ready','dormant'];
  let data = {locations:[],catalog:[],batches:[],transactions:[],tasks:[],members:[],invitations:[],activity:[],loading:false,offline:false,error:null};

  const client = () => LedgerAuth.client;
  const organizationId = () => LedgerAuth.getContext().organization.id;
  const money = value => value == null ? '—' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value));
  const label = value => String(value||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
  const option = (value,text) => `<option value="${esc(value)}">${esc(text)}</option>`;

  async function load(){
    data.loading=true; data.error=null;
    const org=organizationId();
    const [locations,catalog,batches,transactions,tasks,members,invitations,activity]=await Promise.all([
      client().from('locations').select('*').eq('organization_id',org).order('name'),
      client().from('plant_catalog').select('*').eq('organization_id',org).order('common_name'),
      client().from('inventory_batches').select('*, plant_catalog(*), location:locations(*)').eq('organization_id',org).order('created_at',{ascending:false}),
      client().from('inventory_transactions').select('*').eq('organization_id',org).order('created_at',{ascending:false}).limit(100),
      client().from('care_tasks').select('*, assignee:profiles!care_tasks_assigned_to_fkey(display_name), location:locations(name), batch:inventory_batches(batch_code,plant_catalog(common_name))').eq('organization_id',org).order('due_at'),
      client().from('organization_members').select('profile_id,role,profile:profiles(display_name)').eq('organization_id',org),
      client().from('organization_invitations').select('*').eq('organization_id',org).is('accepted_at',null).order('created_at',{ascending:false}),
      client().from('activity_logs').select('*, actor:profiles(display_name)').eq('organization_id',org).order('created_at',{ascending:false}).limit(50)
    ]);
    const failed=[locations,catalog,batches,transactions,tasks,members,invitations,activity].find(result=>result.error);
    if(failed){
      const cached=await loadData(`cloud-${org}`,null);
      if(cached){ data={...cached,loading:false,offline:true,error:'Showing the last saved cloud snapshot.'}; }
      else { data.loading=false; data.offline=true; data.error=failed.error.message; }
      return;
    }
    data={locations:locations.data||[],catalog:catalog.data||[],batches:batches.data||[],transactions:transactions.data||[],tasks:tasks.data||[],members:members.data||[],invitations:invitations.data||[],activity:activity.data||[],loading:false,offline:false,error:null};
    await saveData(`cloud-${org}`,data);
  }

  async function refresh(message){
    await load();
    if(typeof render==='function') render();
    if(message) showToast(message);
  }

  function renderInventory(){
    if(data.loading) return '<div class="empty">Loading greenhouse inventory…</div>';
    const total=data.batches.reduce((sum,batch)=>sum+batch.quantity,0);
    const retail=data.batches.filter(batch=>batch.stage==='retail_ready').reduce((sum,batch)=>sum+batch.quantity,0);
    return `
      ${data.error?`<div class="sync-notice ${data.offline?'offline':''}">${esc(data.error)}</div>`:''}
      <div class="metric-grid">
        <div class="metric"><span>Units on hand</span><strong>${total}</strong></div>
        <div class="metric"><span>Active batches</span><strong>${data.batches.length}</strong></div>
        <div class="metric"><span>Retail ready</span><strong>${retail}</strong></div>
        <div class="metric"><span>Locations</span><strong>${data.locations.length}</strong></div>
      </div>
      <div class="section-label">Receive inventory</div>
      ${data.catalog.length&&data.locations.length?`
        <form class="ops-form" onsubmit="CloudLedger.addBatch(event)">
          <label>Plant<select name="plant_catalog_id" required>${data.catalog.map(item=>option(item.id,item.common_name+(item.cultivar?` · ${item.cultivar}`:''))).join('')}</select></label>
          <label>Location<select name="location_id" required>${data.locations.map(item=>option(item.id,item.name)).join('')}</select></label>
          <label>Quantity<input name="quantity" type="number" min="1" required></label>
          <label>Stage<select name="stage">${STAGES.map(stage=>option(stage,label(stage))).join('')}</select></label>
          <label>Batch code<input name="batch_code" placeholder="optional"></label>
          <label>Unit cost<input name="unit_cost" type="number" min="0" step="0.01"></label>
          <label>Unit price<input name="unit_price" type="number" min="0" step="0.01"></label>
          <button class="btn primary" type="submit">Receive batch</button>
        </form>`:
        `<div class="empty">Add at least one location and one catalog plant before receiving inventory.</div>`}
      <div class="section-label">Current batches</div>
      ${data.batches.length?data.batches.map(batch=>`
        <div class="card inventory-card">
          <div class="card-top"><div><div class="plant-name">${esc(batch.plant_catalog.common_name)}</div><div class="plant-species">${esc(batch.location?.name||'Unassigned')} · ${esc(label(batch.stage))}${batch.batch_code?` · ${esc(batch.batch_code)}`:''}</div></div><div class="stock-count">${batch.quantity}<small>units</small></div></div>
          <div class="due-row"><div class="due-chip due-ok">Cost ${money(batch.unit_cost)}</div><div class="due-chip due-ok">Price ${money(batch.unit_price)}</div></div>
          <div class="card-actions"><label class="btn small photo-label">${batch.photo_path?'Replace photo':'Add photo'}<input type="file" accept="image/jpeg,image/png,image/webp" onchange="CloudLedger.uploadBatchPhoto(event,'${batch.id}')"></label></div>
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
        <section><div class="section-label">Growing locations</div>
          <form class="stack-form" onsubmit="CloudLedger.addLocation(event)"><input name="name" placeholder="e.g. House 1 · Bench A" required><select name="location_type"><option>greenhouse</option><option>room</option><option>zone</option><option>bench</option><option>retail</option></select><input name="notes" placeholder="Notes (optional)"><button class="btn primary" type="submit">Add location</button></form>
          ${data.locations.map(location=>`<div class="mini-row"><span><strong>${esc(location.name)}</strong><small>${esc(label(location.location_type))}</small></span></div>`).join('')||'<div class="empty">No locations yet.</div>'}
        </section>
        <section><div class="section-label">Plant catalog</div>
          <form class="stack-form" onsubmit="CloudLedger.addCatalogPlant(event)"><input name="common_name" placeholder="Common name" required><input name="scientific_name" placeholder="Scientific name"><input name="cultivar" placeholder="Cultivar"><input name="sku" placeholder="SKU"><input name="default_price" type="number" min="0" step="0.01" placeholder="Default price"><div class="form-pair"><input name="watering_days" type="number" min="1" placeholder="Water days"><input name="feeding_days" type="number" min="1" placeholder="Feed days"></div><button class="btn primary" type="submit">Add catalog plant</button></form>
          ${data.catalog.map(plant=>`<div class="mini-row"><span><strong>${esc(plant.common_name)}</strong><small>${esc([plant.scientific_name,plant.cultivar,plant.sku].filter(Boolean).join(' · ')||'No details')}</small></span><b>${money(plant.default_price)}</b></div>`).join('')||'<div class="empty">No catalog plants yet.</div>'}
        </section>
      </div>`;
  }

  function renderOperations(){
    const now=new Date(); const open=data.tasks.filter(t=>!['completed','cancelled'].includes(t.status));
    const overdue=open.filter(t=>t.due_at&&new Date(t.due_at)<now); const low=data.batches.filter(b=>b.quantity<=5);
    const memberOptions='<option value="">Unassigned</option>'+data.members.map(m=>option(m.profile_id,m.profile?.display_name||m.profile_id.slice(0,8))).join('');
    return `${data.error?`<div class="sync-notice ${data.offline?'offline':''}">${esc(data.error)}</div>`:''}
      <div class="metric-grid"><div class="metric"><span>Open tasks</span><strong>${open.length}</strong></div><div class="metric"><span>Overdue</span><strong>${overdue.length}</strong></div><div class="metric"><span>Low stock</span><strong>${low.length}</strong></div><div class="metric"><span>Staff</span><strong>${data.members.length}</strong></div></div>
      ${low.length?`<div class="sync-notice offline"><strong>Low stock:</strong> ${low.map(b=>esc(`${b.plant_catalog.common_name} (${b.quantity})`)).join(' · ')}</div>`:''}
      <div class="section-label">Create care task</div>
      <form class="ops-form" onsubmit="CloudLedger.addTask(event)"><label>Title<input name="title" required placeholder="Water House 1"></label><label>Type<select name="task_type"><option>watering</option><option>feeding</option><option>inspection</option><option>repotting</option><option>pest_control</option><option>other</option></select></label><label>Due<input name="due_at" type="datetime-local" required></label><label>Assign<select name="assigned_to">${memberOptions}</select></label><label>Location<select name="location_id"><option value="">Any location</option>${data.locations.map(l=>option(l.id,l.name)).join('')}</select></label><label>Repeat days<input name="recurrence_days" type="number" min="1" placeholder="optional"></label><label>Notes<input name="notes"></label><button class="btn primary">Create task</button></form>
      <div class="section-label">Care queue</div>${open.length?open.map(t=>`<div class="today-item"><div><strong>${esc(t.title)}</strong><div class="today-space">${esc(t.location?.name||'All locations')} · ${t.due_at?new Date(t.due_at).toLocaleString():'No due date'} · ${esc(t.assignee?.display_name||'Unassigned')}${t.recurrence_days?` · repeats ${t.recurrence_days}d`:''}</div></div><button class="btn primary small" onclick="CloudLedger.completeTask('${t.id}')">Complete</button></div>`).join(''):'<div class="empty">No open care tasks.</div>'}
      <div class="section-label">Recent activity</div>${data.activity.map(a=>`<div class="mini-row"><span><strong>${esc(label(a.action))}</strong><small>${esc(a.actor?.display_name||'System')} · ${esc(label(a.entity_type))}</small></span><small>${new Date(a.created_at).toLocaleString()}</small></div>`).join('')||'<div class="empty">No activity yet.</div>'}`;
  }

  function renderTeam(){
    const canManage=['owner','manager'].includes(LedgerAuth.getContext().role);
    return `<div class="section-label">Staff</div>${data.members.map(m=>`<div class="mini-row"><span><strong>${esc(m.profile?.display_name||'Unnamed staff member')}</strong><small>${esc(label(m.role))}</small></span></div>`).join('')}
      ${canManage?`<div class="section-label">Invite staff</div><form class="ops-form" onsubmit="CloudLedger.inviteStaff(event)"><label>Email<input name="email" type="email" required></label><label>Role<select name="role"><option>worker</option><option>manager</option></select></label><button class="btn primary">Create invitation</button></form>
      ${data.invitations.map(i=>`<div class="card"><strong>${esc(i.email)}</strong><div class="plant-species">${esc(label(i.role))} · expires ${new Date(i.expires_at).toLocaleDateString()}</div><div class="card-actions"><button class="btn small" onclick="CloudLedger.copyInvite('${i.code}')">Copy invitation link</button></div></div>`).join('')}`:''}`;
  }

  async function addLocation(event){
    event.preventDefault(); const form=new FormData(event.currentTarget);
    const payload={organization_id:organizationId(),name:String(form.get('name')).trim(),location_type:form.get('location_type'),notes:String(form.get('notes')||'').trim()||null};
    const {error}=await client().from('locations').insert(payload); if(error)return showToast(error.message); await refresh('Location added');
  }
  async function addCatalogPlant(event){
    event.preventDefault(); const form=new FormData(event.currentTarget);
    const number=name=>form.get(name)?Number(form.get(name)):null;
    const payload={organization_id:organizationId(),common_name:String(form.get('common_name')).trim(),scientific_name:String(form.get('scientific_name')||'').trim()||null,cultivar:String(form.get('cultivar')||'').trim()||null,sku:String(form.get('sku')||'').trim()||null,default_price:number('default_price'),watering_days:number('watering_days'),feeding_days:number('feeding_days')};
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

  async function addTask(event){event.preventDefault();const f=new FormData(event.currentTarget);const payload={organization_id:organizationId(),title:String(f.get('title')).trim(),task_type:f.get('task_type'),due_at:new Date(f.get('due_at')).toISOString(),assigned_to:f.get('assigned_to')||null,location_id:f.get('location_id')||null,recurrence_days:f.get('recurrence_days')?Number(f.get('recurrence_days')):null,notes:String(f.get('notes')||'').trim()||null};const {error}=await client().from('care_tasks').insert(payload);if(error)return showToast(error.message);await refresh('Care task created');}
  async function completeTask(id){const {error}=await client().rpc('complete_care_task',{target_task_id:id});if(error)return showToast(error.message);await refresh('Task completed');}
  async function inviteStaff(event){event.preventDefault();const f=new FormData(event.currentTarget);const {error}=await client().from('organization_invitations').insert({organization_id:organizationId(),email:String(f.get('email')).trim().toLowerCase(),role:f.get('role')});if(error)return showToast(error.message);await refresh('Invitation created');}
  async function copyInvite(code){const url=new URL(location.href);url.searchParams.set('invite',code);await navigator.clipboard.writeText(url.toString());showToast('Invitation link copied');}
  async function uploadBatchPhoto(event,batchId){const file=event.target.files[0];if(!file)return;const path=`${organizationId()}/batches/${batchId}/${crypto.randomUUID()}-${file.name.replace(/[^a-z0-9._-]/gi,'_')}`;const uploaded=await client().storage.from('greenhouse-photos').upload(path,file);if(uploaded.error)return showToast(uploaded.error.message);const {error}=await client().from('inventory_batches').update({photo_path:path}).eq('id',batchId);if(error)return showToast(error.message);await refresh('Batch photo uploaded');}

  window.CloudLedger={load,renderInventory,renderSetup,renderOperations,renderTeam,addLocation,addCatalogPlant,addBatch,adjustStock,addTask,completeTask,inviteStaff,copyInvite,uploadBatchPhoto,getData:()=>data};
})();
