(function(){
  const STAGES = ['propagation','seedling','vegetative','finishing','retail_ready','dormant'];
  let data = {locations:[],catalog:[],batches:[],transactions:[],loading:false,offline:false,error:null};

  const client = () => LedgerAuth.client;
  const organizationId = () => LedgerAuth.getContext().organization.id;
  const money = value => value == null ? '—' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value));
  const label = value => String(value||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
  const option = (value,text) => `<option value="${esc(value)}">${esc(text)}</option>`;

  async function load(){
    data.loading=true; data.error=null;
    const org=organizationId();
    const [locations,catalog,batches,transactions]=await Promise.all([
      client().from('locations').select('*').eq('organization_id',org).order('name'),
      client().from('plant_catalog').select('*').eq('organization_id',org).order('common_name'),
      client().from('inventory_batches').select('*, plant_catalog(*), location:locations(*)').eq('organization_id',org).order('created_at',{ascending:false}),
      client().from('inventory_transactions').select('*').eq('organization_id',org).order('created_at',{ascending:false}).limit(100)
    ]);
    const failed=[locations,catalog,batches,transactions].find(result=>result.error);
    if(failed){
      const cached=await loadData(`cloud-${org}`,null);
      if(cached){ data={...cached,loading:false,offline:true,error:'Showing the last saved cloud snapshot.'}; }
      else { data.loading=false; data.offline=true; data.error=failed.error.message; }
      return;
    }
    data={locations:locations.data||[],catalog:catalog.data||[],batches:batches.data||[],transactions:transactions.data||[],loading:false,offline:false,error:null};
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

  window.CloudLedger={load,renderInventory,renderSetup,addLocation,addCatalogPlant,addBatch,adjustStock,getData:()=>data};
})();
