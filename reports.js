(function(){
  const lowStockLevel = () => WorkspaceSettings.lowStockThreshold();
  const movementLabels = {
    received:'Received', sale:'Sold', loss:'Lost', propagation:'Propagated',
    adjustment:'Adjusted', transfer_in:'Transferred in', transfer_out:'Transferred out'
  };

  const money = value => WorkspaceSettings.money(value);
  const dateValue = daysAgo => {
    const date=new Date(); date.setDate(date.getDate()-daysAgo);
    return date.toISOString().slice(0,10);
  };
  const startOfDay = value => new Date(`${value}T00:00:00`).getTime();
  const endOfDay = value => new Date(`${value}T23:59:59.999`).getTime();
  const reportState = {from:dateValue(30),to:dateValue(0)};

  function reportData(){
    const data=CloudLedger.getData();
    const from=startOfDay(reportState.from); const to=endOfDay(reportState.to);
    const transactions=data.transactions.filter(item=>{
      const created=new Date(item.created_at).getTime();
      return created>=from&&created<=to;
    });
    const units=data.batches.reduce((sum,batch)=>sum+Number(batch.quantity||0),0);
    const costValue=data.batches.reduce((sum,batch)=>sum+Number(batch.quantity||0)*Number(batch.unit_cost||0),0);
    const retailValue=data.batches.reduce((sum,batch)=>sum+Number(batch.quantity||0)*Number(batch.unit_price||batch.plant_catalog?.default_price||0),0);
    const lowStock=data.batches.filter(batch=>Number(batch.quantity)<=lowStockLevel()).sort((a,b)=>a.quantity-b.quantity);
    const movements=transactions.reduce((summary,item)=>{
      summary[item.transaction_type]=(summary[item.transaction_type]||0)+Number(item.quantity||0);
      return summary;
    },{});
    return {data,transactions,units,costValue,retailValue,lowStock,movements};
  }

  function renderReports(){
    const report=reportData();
    const margin=report.retailValue-report.costValue;
    const movementRows=Object.entries(report.movements).sort((a,b)=>b[1]-a[1]);
    return `
      <style>
        .report-toolbar{display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:16px}.report-toolbar label{display:grid;gap:5px;font-size:10px;color:var(--ink-dim);text-transform:uppercase}.report-actions{display:flex;gap:8px;flex-wrap:wrap}.report-table{width:100%;border-collapse:collapse;font-size:12px}.report-table th,.report-table td{padding:9px 7px;text-align:left;border-bottom:1px solid var(--line)}.report-table th{color:var(--ink-dim);font-size:10px;text-transform:uppercase;letter-spacing:.05em}.report-table td:last-child,.report-table th:last-child{text-align:right}.report-note{color:var(--ink-dim);font-size:11px;line-height:1.45;margin-top:9px}
        @media(max-width:600px){.report-scroll{overflow-x:auto}.report-table{min-width:520px}}
        @media print{.tabs,.account-bar,.report-toolbar,.report-actions,.footer,button{display:none!important}.wrap{max-width:none;padding:0}.card{break-inside:avoid}}
      </style>
      <div class="section-label">Inventory reporting</div>
      <div class="report-toolbar">
        <label>From<input type="date" value="${reportState.from}" onchange="LedgerReports.setRange('from',this.value)"></label>
        <label>Through<input type="date" value="${reportState.to}" onchange="LedgerReports.setRange('to',this.value)"></label>
        <div class="report-actions"><button class="btn" onclick="LedgerReports.exportInventory()">Export inventory CSV</button><button class="btn" onclick="LedgerReports.exportTransactions()">Export movements CSV</button><button class="btn" onclick="window.print()">Print report</button></div>
      </div>
      <div class="metric-grid">
        <div class="metric"><span>Units on hand</span><strong>${report.units}</strong></div>
        <div class="metric"><span>Inventory cost</span><strong>${money(report.costValue)}</strong></div>
        <div class="metric"><span>Retail value</span><strong>${money(report.retailValue)}</strong></div>
        <div class="metric"><span>Potential margin</span><strong>${money(margin)}</strong></div>
      </div>
      <div class="ops-columns">
        <section><div class="section-label">Movement summary</div>
          ${movementRows.length?`<div class="card">${movementRows.map(([type,quantity])=>`<div class="mini-row"><span>${esc(movementLabels[type]||type)}</span><strong>${quantity}</strong></div>`).join('')}</div>`:'<div class="empty">No movements in this date range.</div>'}
          <div class="report-note">The on-screen summary uses the latest synchronized activity. The CSV export securely retrieves the complete selected date range from Supabase.</div>
        </section>
        <section><div class="section-label">Low-stock review</div>
          ${report.lowStock.length?`<div class="report-scroll"><table class="report-table"><thead><tr><th>Plant</th><th>Location</th><th>Stage</th><th>Units</th></tr></thead><tbody>${report.lowStock.map(batch=>`<tr><td>${esc(batch.plant_catalog?.common_name||'Unknown')}</td><td>${esc(batch.location?.name||'Unassigned')}</td><td>${esc(String(batch.stage||'').replaceAll('_',' '))}</td><td>${batch.quantity}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No batches are at or below ${lowStockLevel()} units.</div>'}
        </section>
      </div>`;
  }

  function setRange(key,value){
    if(!value)return;
    reportState[key]=value;
    if(reportState.from>reportState.to){
      const other=key==='from'?'to':'from'; reportState[other]=value;
    }
    if(typeof render==='function')render();
  }

  function csvCell(value){
    let text=value==null?'':String(value);
    if(/^[=+\-@]/.test(text))text=`'${text}`;
    return `"${text.replaceAll('"','""')}"`;
  }
  function downloadCsv(filename,headers,rows){
    const body=[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');
    const blob=new Blob([`\ufeff${body}`],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob); const link=document.createElement('a');
    link.href=url; link.download=filename; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function exportInventory(){
    const {batches}=CloudLedger.getData();
    downloadCsv(`greenhouse-inventory-${new Date().toISOString().slice(0,10)}.csv`,
      ['Plant','Scientific name','Cultivar','SKU','Batch code','Location','Stage','Quantity','Unit cost','Unit price','Cost value','Retail value','Acquired on'],
      batches.map(batch=>{
        const catalog=batch.plant_catalog||{}; const quantity=Number(batch.quantity||0);
        const price=Number(batch.unit_price||catalog.default_price||0); const cost=Number(batch.unit_cost||0);
        return [catalog.common_name,catalog.scientific_name,catalog.cultivar,catalog.sku,batch.batch_code,batch.location?.name,batch.stage,quantity,cost,price,quantity*cost,quantity*price,batch.acquired_on];
      }));
    showToast('Inventory CSV exported');
  }

  async function exportTransactions(){
    const organizationId=LedgerAuth.getContext().organization.id;
    const rows=[]; const pageSize=1000;
    for(let from=0;;from+=pageSize){
      const result=await LedgerAuth.client.from('inventory_transactions')
        .select('created_at,transaction_type,quantity,note,batch:inventory_batches(batch_code,plant_catalog(common_name,sku),location:locations(name))')
        .eq('organization_id',organizationId)
        .gte('created_at',`${reportState.from}T00:00:00`)
        .lte('created_at',`${reportState.to}T23:59:59.999`)
        .order('created_at',{ascending:false}).range(from,from+pageSize-1);
      if(result.error){showToast(result.error.message);return;}
      rows.push(...(result.data||[]));
      if((result.data||[]).length<pageSize)break;
    }
    downloadCsv(`greenhouse-movements-${reportState.from}-to-${reportState.to}.csv`,
      ['Date','Type','Quantity','Plant','SKU','Batch code','Location','Note'],
      rows.map(item=>[item.created_at,item.transaction_type,item.quantity,item.batch?.plant_catalog?.common_name,item.batch?.plant_catalog?.sku,item.batch?.batch_code,item.batch?.location?.name,item.note]));
    showToast('Movement CSV exported');
  }

  const originalRenderOperations=CloudLedger.renderOperations;
  CloudLedger.renderOperations=()=>originalRenderOperations()+renderReports();
  window.LedgerReports={setRange,exportInventory,exportTransactions};
})();
