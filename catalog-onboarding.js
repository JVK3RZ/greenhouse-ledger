(function(){
  const MAX_ROWS=500;
  const REQUIRED='common_name';
  const columns=['common_name','scientific_name','cultivar','sku','default_price','watering_days','feeding_days'];

  function csvCell(value){
    const text=String(value==null?'':value);
    return '"' + text.replaceAll('"','""') + '"';
  }

  function downloadTemplate(){
    const rows=[
      columns,
      ['Golden Pothos','Epipremnum aureum','','POTHOS-GOLDEN','12.00','8','30'],
      ['Monstera Thai Constellation','Monstera deliciosa','Thai Constellation','MON-THAI','74.00','9','30']
    ];
    const blob=new Blob(['\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url; link.download='greenhouse-ledger-catalog-template.csv'; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    showToast('Catalog template downloaded');
  }

  function parseCsv(text){
    const rows=[]; let row=[]; let cell=''; let quoted=false;
    text=String(text||'').replace(/^\uFEFF/,'');
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(quoted){
        if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}
        else if(ch==='"'){quoted=false;}
        else cell+=ch;
      }else if(ch==='"'){quoted=true;}
      else if(ch===','){row.push(cell);cell='';}
      else if(ch==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
      else cell+=ch;
    }
    if(quoted)throw new Error('The CSV contains an unclosed quoted field.');
    if(cell.length||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
    return rows.filter(item=>item.some(value=>String(value).trim()));
  }

  function numberValue(value,label,rowNumber,integer){
    const text=String(value||'').trim();
    if(!text)return null;
    const number=Number(text);
    if(!Number.isFinite(number)||number<0||(integer&&!Number.isInteger(number))){
      throw new Error(`Row ${rowNumber}: ${label} must be a non-negative ${integer?'whole number':'number'}.`);
    }
    return number;
  }

  function validate(text){
    const parsed=parseCsv(text);
    if(parsed.length<2)throw new Error('Add at least one plant row below the header.');
    if(parsed.length-1>MAX_ROWS)throw new Error(`Import no more than ${MAX_ROWS} plants at a time.`);
    const headers=parsed[0].map(value=>String(value).trim().toLowerCase());
    if(!headers.includes(REQUIRED))throw new Error('The CSV must include a common_name column.');
    const unknown=headers.filter(header=>header&&!columns.includes(header));
    if(unknown.length)throw new Error(`Unknown column${unknown.length===1?'':'s'}: ${unknown.join(', ')}.`);
    const seenFileSkus=new Set();
    const existingSkus=new Set(CloudLedger.getData().catalog.map(item=>String(item.sku||'').toLowerCase()).filter(Boolean));
    return parsed.slice(1).map((values,index)=>{
      const raw={};headers.forEach((header,column)=>{if(header)raw[header]=String(values[column]||'').trim();});
      const rowNumber=index+2;
      if(!raw.common_name)throw new Error(`Row ${rowNumber}: common_name is required.`);
      if(raw.common_name.length>160)throw new Error(`Row ${rowNumber}: common_name is too long.`);
      const sku=String(raw.sku||'').trim();
      const normalized=sku.toLowerCase();
      if(normalized&&seenFileSkus.has(normalized))throw new Error(`Row ${rowNumber}: SKU "${sku}" appears more than once in this file.`);
      if(normalized&&existingSkus.has(normalized))throw new Error(`Row ${rowNumber}: SKU "${sku}" already exists in this organization.`);
      if(normalized)seenFileSkus.add(normalized);
      return {
        organization_id:LedgerAuth.getContext().organization.id,
        common_name:raw.common_name,
        scientific_name:raw.scientific_name||null,
        cultivar:raw.cultivar||null,
        sku:sku||null,
        default_price:numberValue(raw.default_price,'default_price',rowNumber,false),
        watering_days:numberValue(raw.watering_days,'watering_days',rowNumber,true),
        feeding_days:numberValue(raw.feeding_days,'feeding_days',rowNumber,true)
      };
    });
  }

  function checklist(){
    const data=CloudLedger.getData();
    const items=[
      {done:data.locations.length>0,label:'Add a growing location',detail:'Create a greenhouse, room, zone, bench, or retail area.'},
      {done:data.catalog.length>0,label:'Build the plant catalog',detail:'Add plants manually or import an existing catalog from CSV.'},
      {done:data.batches.length>0,label:'Receive the first inventory batch',detail:'Connect a catalog plant to a location and starting quantity.'},
      {done:data.members.length>1,label:'Invite a staff member',detail:'Owners and managers can create time-limited invitation links.'}
    ];
    const complete=items.filter(item=>item.done).length;
    return `<div class="section-label">Pilot setup</div>
      <div class="card onboarding-card"><div class="card-top"><div><div class="plant-name">Workspace readiness</div><div class="plant-species">${complete} of ${items.length} setup steps complete</div></div><div class="stock-count">${Math.round(complete/items.length*100)}<small>percent</small></div></div>
      <div class="setup-progress"><span style="width:${complete/items.length*100}%"></span></div>
      ${items.map(item=>`<div class="setup-step ${item.done?'done':''}"><span class="setup-check">${item.done?'✓':'○'}</span><span><strong>${esc(item.label)}</strong><small>${esc(item.detail)}</small></span></div>`).join('')}</div>`;
  }

  function importer(){
    return `<div class="section-label">Bulk catalog import</div>
      <div class="card">
        <p class="sub">Bring an existing plant catalog into this organization from a CSV file. The file is validated before anything is saved, and the complete import succeeds or fails together.</p>
        <div class="card-actions"><button class="btn" type="button" onclick="CatalogOnboarding.downloadTemplate()">Download CSV template</button><label class="btn primary photo-label">Choose catalog CSV<input type="file" accept=".csv,text/csv" onchange="CatalogOnboarding.chooseFile(event)"></label></div>
        <div id="catalog-import-preview" class="import-preview"></div>
      </div>`;
  }

  async function chooseFile(event){
    const file=event.target.files[0]; if(!file)return;
    const preview=document.getElementById('catalog-import-preview');
    try{
      const rows=validate(await file.text());
      window.CatalogOnboarding.pending=rows;
      preview.innerHTML=`<div class="sync-notice"><strong>${rows.length} plant${rows.length===1?'':'s'} ready.</strong> Review the first entries below, then import them into ${esc(LedgerAuth.getContext().organization.name)}.</div>
        <div class="import-list">${rows.slice(0,5).map(row=>`<div class="mini-row"><span><strong>${esc(row.common_name)}</strong><small>${esc([row.scientific_name,row.cultivar,row.sku].filter(Boolean).join(' · ')||'No optional details')}</small></span></div>`).join('')}</div>
        ${rows.length>5?`<p class="report-note">Plus ${rows.length-5} more rows.</p>`:''}
        <button class="btn primary" type="button" onclick="CatalogOnboarding.commit()">Import ${rows.length} plants</button>`;
    }catch(error){
      window.CatalogOnboarding.pending=null;
      preview.innerHTML=`<div class="sync-notice"><strong>Import needs attention.</strong> ${esc(error.message)}</div>`;
    }
    event.target.value='';
  }

  async function commit(){
    const rows=window.CatalogOnboarding.pending;
    if(!rows||!rows.length)return;
    const button=document.querySelector('#catalog-import-preview button.primary');
    if(button){button.disabled=true;button.textContent='Importing…';}
    const {error}=await LedgerAuth.client.from('plant_catalog').insert(rows);
    if(error){showToast(error.message);if(button){button.disabled=false;button.textContent='Try import again';}return;}
    window.CatalogOnboarding.pending=null;
    await CloudLedger.load();
    render();
    showToast(`${rows.length} catalog plants imported`);
  }

  const original=CloudLedger.renderSetup;
  CloudLedger.renderSetup=()=>`<style>
    .setup-progress{height:7px;background:var(--soil-2);border-radius:10px;overflow:hidden;margin:14px 0}.setup-progress span{display:block;height:100%;background:var(--moss-light)}.setup-step{display:flex;gap:10px;padding:9px 0;border-top:1px solid var(--line);color:var(--ink-dim)}.setup-step.done{color:var(--ink)}.setup-check{color:var(--moss-light);font-size:18px;line-height:1}.setup-step small{display:block;margin-top:3px;color:var(--ink-dim)}.import-preview{margin-top:14px}.import-list{margin-bottom:12px}
  </style>${checklist()}${importer()}${original()}`;
  window.CatalogOnboarding={pending:null,downloadTemplate,chooseFile,commit};
})();
