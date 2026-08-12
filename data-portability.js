(function(){
  const FORMAT='greenhouse-ledger-cloud-backup';
  const VERSION=2;
  const PAGE_SIZE=500;
  const tables=[
    {key:'locations',name:'locations',order:'created_at'},
    {key:'plant_catalog',name:'plant_catalog',order:'created_at'},
    {key:'inventory_batches',name:'inventory_batches',order:'created_at'},
    {key:'inventory_transactions',name:'inventory_transactions',order:'created_at'},
    {key:'care_tasks',name:'care_tasks',order:'created_at'},
    {key:'inventory_counts',name:'inventory_counts',order:'started_at'},
    {key:'inventory_count_lines',name:'inventory_count_lines',order:'created_at'},
    {key:'plant_health_issues',name:'plant_health_issues',order:'created_at'},
    {key:'plant_health_issue_updates',name:'plant_health_issue_updates',order:'created_at'},
    {key:'organization_members',name:'organization_members',order:'profile_id'},
    {key:'organization_invitations',name:'organization_invitations',order:'created_at'},
    {key:'activity_logs',name:'activity_logs',order:'created_at'}
  ];
  const recoveryKeys=['locations','plant_catalog','inventory_batches','inventory_transactions','care_tasks','inventory_counts','inventory_count_lines','plant_health_issues','plant_health_issue_updates'];
  let selectedBackup=null;
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
      const backup={format:FORMAT,version:VERSION,exported_at:new Date().toISOString(),organization,summary:counts(data),integrity:{algorithm:'SHA-256',checksum:await checksum(data)},recovery:{mode:'additive',recoverable_sections:recoveryKeys,inspection_only_sections:['organization_members','organization_invitations','activity_logs']},data,notes:'Recovery adds missing operational records only. Existing records are never overwritten or deleted. Identity, invitation, and generated activity records are inspection-only. Photo database paths are included; binary photo files are not embedded.'};
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
      const backup=await validate(file);const summary=counts(backup.data);selectedBackup=backup;
      const sameWorkspace=backup.organization.id===context().organization.id;
      preview.innerHTML=`<div class="sync-notice"><strong>${backup.verified?'Integrity verified':'Structure verified'}.</strong> ${esc(backup.organization.name)} · exported ${new Date(backup.exported_at).toLocaleString()}</div><div class="backup-counts">${tables.map(table=>`<div class="metric"><span>${esc(table.key.replaceAll('_',' '))}</span><strong>${summary[table.key]}</strong></div>`).join('')}</div><div class="recovery-plan"><strong>Additive recovery plan</strong><p>Missing operational records can be restored. Existing live records are kept exactly as they are; nothing is overwritten or deleted.</p><p>Memberships, invitations, activity logs, and photo files are inspection-only.</p>${context().role==='owner'&&sameWorkspace?`<button class="btn primary" type="button" onclick="DataPortability.restoreSelected()">Recover missing records</button>`:`<span class="report-note">${sameWorkspace?'Only the organization owner can run recovery.':'This backup belongs to a different workspace and cannot be restored here.'}</span>`}</div>`;
    }catch(error){preview.innerHTML=`<div class="sync-notice"><strong>Backup needs attention.</strong> ${esc(error.message)}</div>`;}
    event.target.value='';
  }
  async function restoreSelected(){
    if(context().role!=='owner'||!selectedBackup)return showToast('Inspect a valid backup as the organization owner first');
    const expected=context().organization.name;const typed=prompt(`Type ${expected} to confirm additive recovery.`);
    if(typed!==expected)return showToast('Recovery cancelled');
    await exportCloud();
    const {data:run,error}=await LedgerAuth.client.rpc('restore_cloud_backup',{target_organization_id:context().organization.id,backup:selectedBackup});
    if(error)return showToast(error.message);
    selectedBackup=null;await CloudLedger.load();render();
    const total=Object.values(run?.restored_counts||{}).reduce((sum,value)=>sum+Number(value||0),0);
    showToast(`${total} missing records recovered`);
  }
  function markup(){
    if(!canManage())return '';
    return `<div class="section-label">Data portability &amp; recovery</div><div class="card cloud-backup-card"><p class="sub">Download a complete, organization-scoped JSON backup, inspect its integrity, and recover missing operational records without replacing live data.</p><div class="card-actions"><button id="cloud-backup-export" class="btn primary" type="button" onclick="DataPortability.exportCloud()">Export cloud backup</button><label class="btn photo-label">Inspect for recovery<input type="file" accept="application/json,.json" onchange="DataPortability.inspect(event)"></label></div><div class="retention-policy"><strong>Recommended retention</strong><p>Keep the three newest monthly backups and one backup before any major import or recovery. Delete superseded files after 90 days unless the business requires longer retention. Store files in a restricted business account because they may contain staff names and invitation email addresses.</p></div><p class="report-note">Greenhouse Ledger does not retain downloaded backup files on its servers. Uploaded photo files are not embedded.</p><div id="cloud-backup-preview"></div></div>`;
  }
  const originalTeam=CloudLedger.renderTeam;
  CloudLedger.renderTeam=()=>originalTeam()+markup()+`<style>.backup-counts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.backup-counts .metric strong{font-size:20px}.retention-policy,.recovery-plan{margin-top:14px;padding:13px;border-radius:9px;background:var(--soil-2)}.retention-policy p,.recovery-plan p{color:var(--ink-dim);font-size:12px;line-height:1.5}.recovery-plan .btn{margin-top:4px}@media(max-width:720px){.backup-counts{grid-template-columns:1fr 1fr}}</style>`;
  window.DataPortability={exportCloud,inspect,restoreSelected};
})();
