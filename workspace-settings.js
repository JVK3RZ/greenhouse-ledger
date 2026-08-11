(function(){
  const currencyOptions=['USD','CAD','EUR','GBP','AUD','NZD'];
  const timezoneOptions=[
    'America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
    'America/Phoenix','America/Anchorage','Pacific/Honolulu','UTC',
    'Europe/London','Europe/Paris','Australia/Sydney'
  ];

  function organization(){
    return LedgerAuth.getContext().organization;
  }
  function lowStockThreshold(){
    const value=Number(organization()?.low_stock_threshold);
    return Number.isInteger(value)&&value>=0?value:5;
  }
  function currencyCode(){
    return String(organization()?.currency_code||'USD').toUpperCase();
  }
  function money(value){
    try{
      return new Intl.NumberFormat(undefined,{style:'currency',currency:currencyCode(),maximumFractionDigits:2}).format(Number(value)||0);
    }catch(error){
      return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(Number(value)||0);
    }
  }
  function option(value,current){
    return `<option value="${esc(value)}" ${value===current?'selected':''}>${esc(value.replaceAll('_',' '))}</option>`;
  }
  function renderMarkup(){
    const context=LedgerAuth.getContext();
    const org=context.organization;
    const canManage=['owner','manager'].includes(context.role);
    if(!canManage){
      return `<div class="section-label">Workspace settings</div><div class="card"><div class="mini-row"><span><strong>${esc(org.name)}</strong><small>${esc(currencyCode())} · ${esc(org.timezone||'America/New_York')} · low stock at ${lowStockThreshold()} units</small></span></div></div>`;
    }
    const timezone=org.timezone||'America/New_York';
    const zones=timezoneOptions.includes(timezone)?timezoneOptions:[timezone,...timezoneOptions];
    return `<div class="section-label">Workspace settings</div>
      <form class="card workspace-settings" onsubmit="WorkspaceSettings.save(event)">
        <div class="ops-form">
          <label>Business name<input name="name" value="${esc(org.name)}" minlength="2" maxlength="120" required></label>
          <label>Currency<select name="currency_code">${currencyOptions.map(value=>option(value,currencyCode())).join('')}</select></label>
          <label>Timezone<select name="timezone">${zones.map(value=>option(value,timezone)).join('')}</select></label>
          <label>Low-stock alert<input name="low_stock_threshold" type="number" min="0" max="100000" step="1" value="${lowStockThreshold()}" required></label>
          <button class="btn primary" type="submit">Save workspace settings</button>
        </div>
        <p class="report-note">Currency changes how monetary values are displayed; stored numeric costs and prices are not converted. The low-stock threshold applies to dashboard alerts and reports.</p>
      </form>`;
  }
  async function save(event){
    event.preventDefault();
    const button=event.currentTarget.querySelector('button[type="submit"]');
    const form=new FormData(event.currentTarget);
    const payload={
      name:String(form.get('name')||'').trim(),
      currency_code:String(form.get('currency_code')||'USD').toUpperCase(),
      timezone:String(form.get('timezone')||'America/New_York'),
      low_stock_threshold:Number(form.get('low_stock_threshold'))
    };
    if(!payload.name||!Number.isInteger(payload.low_stock_threshold)||payload.low_stock_threshold<0){
      showToast('Check the workspace settings and try again');
      return;
    }
    button.disabled=true;
    const {data,error}=await LedgerAuth.client.from('organizations').update(payload).eq('id',organization().id).select('id,name,currency_code,timezone,low_stock_threshold').single();
    button.disabled=false;
    if(error){showToast(error.message);return;}
    Object.assign(LedgerAuth.getContext().organization,data);
    render();
    showToast('Workspace settings saved');
  }

  window.WorkspaceSettings={lowStockThreshold,currencyCode,money,save,renderMarkup};
})();
