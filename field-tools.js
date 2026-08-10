(function(){
  const state={query:'',location:'',stage:'',focus:null};
  const label=value=>String(value||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
  const option=(value,text,selected)=>`<option value="${esc(value)}" ${String(value)===String(selected)?'selected':''}>${esc(text)}</option>`;

  function matches(batch){
    const q=state.query.trim().toLowerCase();
    const catalog=batch.plant_catalog||{};
    const haystack=[catalog.common_name,catalog.scientific_name,catalog.cultivar,catalog.sku,batch.batch_code,batch.location?.name].filter(Boolean).join(' ').toLowerCase();
    return (!q||haystack.includes(q))&&(!state.location||batch.location_id===state.location)&&(!state.stage||batch.stage===state.stage);
  }

  function toolbar(){
    const data=CloudLedger.getData();
    const stages=[...new Set(data.batches.map(batch=>batch.stage).filter(Boolean))].sort();
    const visible=data.batches.filter(matches).length;
    return `<style>
      .field-toolbar{display:grid;grid-template-columns:minmax(220px,2fr) 1fr 1fr auto;gap:8px;align-items:end;margin:0 0 16px}.field-toolbar label{display:grid;gap:5px;font-size:10px;color:var(--ink-dim);text-transform:uppercase}.field-toolbar input,.field-toolbar select{width:100%}.field-count{font-size:11px;color:var(--ink-dim);white-space:nowrap;padding:9px 0}.inventory-card.field-hidden{display:none}.inventory-card.field-focus{border-color:var(--clay-light);box-shadow:0 0 0 2px rgba(214,140,95,.18)}.label-sheet{display:none}
      @media(max-width:720px){.field-toolbar{grid-template-columns:1fr 1fr}.field-toolbar label:first-child{grid-column:1/-1}}
      @media print{body.print-batch .wrap>*{display:none!important}body.print-batch .label-sheet{display:grid!important;grid-template-columns:repeat(2,1fr);gap:12px}.batch-label{border:1px solid #222;padding:16px;color:#111;background:#fff;break-inside:avoid}.batch-label strong{display:block;font-size:18px}.batch-label small{display:block;margin-top:5px}.batch-code{font-family:monospace;font-size:16px;margin-top:12px}}
    </style>
    <div class="section-label">Find inventory</div>
    <div class="field-toolbar">
      <label>Plant, SKU, or batch<input type="search" value="${esc(state.query)}" placeholder="Scan or type to find…" oninput="FieldTools.filter('query',this.value)"></label>
      <label>Location<select onchange="FieldTools.filter('location',this.value)"><option value="">All locations</option>${data.locations.map(item=>option(item.id,item.name,state.location)).join('')}</select></label>
      <label>Stage<select onchange="FieldTools.filter('stage',this.value)"><option value="">All stages</option>${stages.map(item=>option(item,label(item),state.stage)).join('')}</select></label>
      <div class="field-count">${visible} of ${data.batches.length} batches</div>
    </div>`;
  }

  function decorate(){
    const cards=[...document.querySelectorAll('.inventory-card')];
    const batches=CloudLedger.getData().batches;
    cards.forEach((card,index)=>{
      const batch=batches[index]; if(!batch)return;
      card.dataset.batchId=batch.id;
      card.classList.toggle('field-hidden',!matches(batch));
      card.classList.toggle('field-focus',state.focus===batch.id);
      const actions=card.querySelector('.card-actions');
      if(actions&&!actions.querySelector('[data-field-label]')){
        const button=document.createElement('button'); button.className='btn small'; button.type='button'; button.dataset.fieldLabel=''; button.textContent='Print label'; button.onclick=()=>printLabel(batch.id); actions.appendChild(button);
        const link=document.createElement('button'); link.className='btn small'; link.type='button'; link.textContent='Copy batch link'; link.onclick=()=>copyLink(batch.id); actions.appendChild(link);
      }
    });
    if(state.focus){document.querySelector(`[data-batch-id="${CSS.escape(state.focus)}"]`)?.scrollIntoView({behavior:'smooth',block:'center'});state.focus=null;}
  }

  function filter(key,value){state[key]=value;render();}
  function copyLink(id){const url=new URL(location.href);url.searchParams.set('batch',id);navigator.clipboard.writeText(url.toString()).then(()=>showToast('Batch link copied')).catch(()=>showToast('Could not copy link'));}
  function printLabel(id){
    const batch=CloudLedger.getData().batches.find(item=>item.id===id); if(!batch)return;
    const catalog=batch.plant_catalog||{};
    const sheet=document.createElement('div');sheet.className='label-sheet';sheet.innerHTML=`<div class="batch-label"><strong>${esc(catalog.common_name||'Unknown plant')}</strong><small>${esc([catalog.cultivar,batch.location?.name,label(batch.stage)].filter(Boolean).join(' · '))}</small><div class="batch-code">${esc(batch.batch_code||catalog.sku||batch.id)}</div><small>${batch.quantity} units · ${new Date().toLocaleDateString()}</small></div>`;
    document.querySelector('.wrap').appendChild(sheet);document.body.classList.add('print-batch');window.print();document.body.classList.remove('print-batch');sheet.remove();
  }

  const original=CloudLedger.renderInventory;
  CloudLedger.renderInventory=()=>toolbar()+original();
  const observer=new MutationObserver(()=>{if(!observer.busy){observer.busy=true;requestAnimationFrame(()=>{decorate();observer.busy=false;});}});
  observer.observe(document.getElementById('app'),{childList:true,subtree:true});
  const requested=new URL(location.href).searchParams.get('batch');if(requested)state.focus=requested;
  window.FieldTools={filter,printLabel,copyLink};
})();
