(function(){
  const FORMAT='greenhouse-ledger-cloud-backup';
  const VERSION=1;
  const PAGE_SIZE=500;
  const tables=[
    {key:'locations',name:'locations',order:'created_at'},
    {key:'plant_catalog',name:'plant_catalog',order:'created_at'},
    {key:'inventory_batches',name:'inventory_batches',order:'created_at'},
    {key:'inventory_transactions',name:'inventory_transactions',order:'created_at'},
    {key:'care_tasks',name:'care_tasks',order:'created_at'},
    {key:'organization_members',name:'organization_members',order:'profile_id'},
    {key:'organization_invitations',name:'organization_invitations',order:'created_at'},
    {key:'activity_logs',name:'activity_logs',order:'created_at'}
  ];
  const context=()=>LedgerAuth.getContext();
  const canManage=()=>['owner','manager'].includes(context()?.role);
  async function allRows(table){
    const rows=[];
    for(let start=0;;start+=PAGE_SIZE){
      const result=await LedgerAuth.client.from(table.name).select('*').eq('organization_id',context().organization.id).order(table.order,{ascending:true}).range(start,start+PAGE_SIZE-1);
      if(result.error)throw result.error;
      rows.push(...(result.data||[]));
      if(!result.data||result.data.length<PAGE_SIZE)return rows;
    }
  }
  function stableJson(value){
    if(Array.isArray(value))return `[${value.map(stableJson).join(',')}]`;
    if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  }
  async function checksum(data){
    if(!crypto.subtle)return null;
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJson(data)));
    return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  function counts(data){return Object.fromEntries(tables.map(table=>[table.key,Array.isArray(data[table.key])?data[table.key].length:0]));}
  async function exportCloud(){
    if(!canManage()){showToast('Only owners and managers can export workspace data');return;}
    const button=document.getElementById('cloud-backup-export');
    if(button){button.disabled=true;button.textContent='Preparing backup…';}
    try{
      const data=Object.fromEntries(await Promise.all(tables.map(async table=>[table.key,await allRows(table)])));
      const organization={...context().organization};
      const backup={format:FORMAT,version:VERSION,exported_at:new Date().toISOString(),organization,summary:counts(data),integrity:{algorithm:'SHA-256',checksum:await checksum(data)},data,notes:'Photo database paths are included; binary photo files are not embedded.'};
      const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');
      const safe=String(organization.name||'workspace').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'workspace';
      link.href=url;link.download=`${safe}-cloud-backup-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('Cloud workspace backup exported');
    }catch(error){showToast(error.message||'Cloud backup could not be created');}
    finally{if(button){button.disabled=false;button.textContent='Export cloud backup';}}
  }
  async function validate(file){
    const backup=JSON.parse(await file.text());
    if(backup.format!==FORMAT||backup.version!==VERSION||!backup.organization||!backup.data)throw new Error('This is not a supported Greenhouse Ledger cloud backup.');
    for(const table of tables)if(!Array.isArray(backup.data[table.key]))throw new Error(`Backup section ${table.key} is missing or invalid.`);
    const foreignRows=tables.flatMap(table=>backup.data[table.key]).filter(row=>row.organization_id!==backup.organization.id);
    if(foreignRows.length)throw new Error('The backup contains records from more than one organization.');
    const actual=await checksum(backup.data);
    if(backup.integrity?.checksum&&actual&&backup.integrity.checksum!==actual)throw new Error('The backup checksum does not match. The file may be incomplete or changed.');
    return {...backup,verified:!!(backup.integrity?.checksum&&actual)};
  }
  async function inspect(event){
    const file=event.target.files[0];if(!file)return;const preview=document.getElementById('cloud-backup-preview');
    try{
      const backup=await validate(file);const summary=counts(backup.data);
      preview.innerHTML=`<div class="sync-notice"><strong>${backup.verified?'Integrity verified':'Structure verified'}.</strong> ${esc(backup.organization.name)} · exported ${new Date(backup.exported_at).toLocaleString()}</div><div class="backup-counts">${tables.map(table=>`<div class="metric"><span>${esc(table.key.replaceAll('_',' '))}</span><strong>${summary[table.key]}</strong></div>`).join('')}</div><p class="report-note">Inspection is read-only. No live workspace data was changed. Photo paths are listed in the backup, but photo files are not embedded.</p>`;
    }catch(error){preview.innerHTML=`<div class="sync-notice"><strong>Backup needs attention.</strong> ${esc(error.message)}</div>`;}
    event.target.value='';
  }
  function markup(){
    if(!canManage())return '';
    return `<div class="section-label">Data portability</div><div class="card cloud-backup-card"><p class="sub">Download a complete, organization-scoped JSON backup of operational records. Use the inspector to verify a backup without changing live data.</p><div class="card-actions"><button id="cloud-backup-export" class="btn primary" type="button" onclick="DataPortability.exportCloud()">Export cloud backup</button><label class="btn photo-label">Inspect backup<input type="file" accept="application/json,.json" onchange="DataPortability.inspect(event)"></label></div><p class="report-note">Backups can contain staff names and invitation email addresses. Store them securely. Uploaded photo files are not embedded.</p><div id="cloud-backup-preview"></div></div>`;
  }
  const originalTeam=CloudLedger.renderTeam;
  CloudLedger.renderTeam=()=>originalTeam()+markup()+`<style>.backup-counts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}.backup-counts .metric strong{font-size:20px}@media(max-width:720px){.backup-counts{grid-template-columns:1fr 1fr}}</style>`;
  window.DataPortability={exportCloud,inspect};
})();
