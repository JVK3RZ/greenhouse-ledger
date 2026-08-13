(function(){
  const currencyOptions=['USD','CAD','EUR','GBP','AUD','NZD'];
  const timezoneOptions=['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Phoenix','America/Anchorage','Pacific/Honolulu','UTC','Europe/London','Europe/Paris','Australia/Sydney'];
  const businessTypes=['greenhouse','nursery','garden_center','farm','other'];
  const quantityLabels=['units','plants','items','pots','trays'];
  const organization=()=>LedgerAuth.getContext().organization;
  const value=(source,fallback='')=>String(source??fallback);
  const clean=form=>name=>String(form.get(name)||'').trim();

  function lowStockThreshold(){const number=Number(organization()?.low_stock_threshold);return Number.isInteger(number)&&number>=0?number:5;}
  function currencyCode(){return value(organization()?.currency_code,'USD').toUpperCase();}
  function quantityLabel(){return value(organization()?.quantity_label,'units');}
  function money(amount){try{return new Intl.NumberFormat(undefined,{style:'currency',currency:currencyCode(),maximumFractionDigits:2}).format(Number(amount)||0);}catch(error){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(Number(amount)||0);}}
  function option(item,current,label=item){return `<option value="${esc(item)}" ${item===current?'selected':''}>${esc(value(label).replaceAll('_',' '))}</option>`;}
  function readOnlyMarkup(org){
    const address=[org.address_line_1,org.address_line_2,org.city,org.region,org.postal_code,org.country_code].filter(Boolean).join(', ');
    return `<div class="section-label">Workspace profile</div><div class="settings-grid"><section class="card settings-section"><h2>${esc(org.name)}</h2><p class="sub">${esc(value(org.business_type,'greenhouse').replaceAll('_',' '))}</p><div class="settings-facts"><span><small>Contact</small><strong>${esc(org.contact_email||org.contact_phone||'Not set')}</strong></span><span><small>Address</small><strong>${esc(address||'Not set')}</strong></span><span><small>Website</small><strong>${esc(org.website_url||'Not set')}</strong></span></div></section><section class="card settings-section"><h2>Inventory preferences</h2><div class="settings-facts"><span><small>Currency</small><strong>${esc(currencyCode())}</strong></span><span><small>Low-stock alert</small><strong>${lowStockThreshold()} ${esc(quantityLabel())}</strong></span><span><small>Code prefixes</small><strong>${esc([org.sku_prefix&&`SKU ${org.sku_prefix}`,org.batch_prefix&&`Batch ${org.batch_prefix}`].filter(Boolean).join(' · ')||'Not set')}</strong></span></div></section></div><p class="report-note">Owners and managers control shared workspace settings.</p>`;
  }
  function renderMarkup(){
    const context=LedgerAuth.getContext();const org=context.organization;const canManage=['owner','manager'].includes(context.role);
    if(!canManage)return readOnlyMarkup(org);
    const timezone=value(org.timezone,'America/New_York');const zones=timezoneOptions.includes(timezone)?timezoneOptions:[timezone,...timezoneOptions];
    return `<form class="workspace-profile-form" onsubmit="WorkspaceSettings.save(event)">
      <div class="section-label">Workspace profile</div>
      <section class="card settings-section"><h2>Business details</h2><p class="sub">Shared company information used to identify this workspace and prepare it for reports and customer-facing documents.</p><div class="settings-form-grid">
        <label>Business name<input name="name" value="${esc(org.name)}" minlength="2" maxlength="120" required></label>
        <label>Business type<select name="business_type">${businessTypes.map(item=>option(item,value(org.business_type,'greenhouse'))).join('')}</select></label>
        <label>Contact email<input name="contact_email" type="email" maxlength="254" value="${esc(org.contact_email||'')}"></label>
        <label>Contact phone<input name="contact_phone" type="tel" maxlength="40" value="${esc(org.contact_phone||'')}"></label>
        <label class="settings-wide">Street address<input name="address_line_1" maxlength="160" value="${esc(org.address_line_1||'')}"></label>
        <label class="settings-wide">Suite, unit, or building<input name="address_line_2" maxlength="160" value="${esc(org.address_line_2||'')}"></label>
        <label>City<input name="city" maxlength="100" value="${esc(org.city||'')}"></label><label>State / region<input name="region" maxlength="100" value="${esc(org.region||'')}"></label>
        <label>Postal code<input name="postal_code" maxlength="24" value="${esc(org.postal_code||'')}"></label><label>Country code<input name="country_code" pattern="[A-Za-z]{2}" maxlength="2" value="${esc(value(org.country_code,'US'))}" required></label>
        <label class="settings-wide">Website<input name="website_url" type="url" maxlength="240" placeholder="https://example.com" value="${esc(org.website_url||'')}"></label>
      </div></section>
      <div class="section-label">Inventory preferences</div>
      <section class="card settings-section"><h2>Stock display and codes</h2><p class="sub">These preferences change labels and suggestions. They never rewrite existing prices, SKUs, batch codes, or quantities.</p><div class="settings-form-grid">
        <label>Currency<select name="currency_code">${currencyOptions.map(item=>option(item,currencyCode())).join('')}</select></label>
        <label>Timezone<select name="timezone">${zones.map(item=>option(item,timezone)).join('')}</select></label>
        <label>Low-stock alert<input name="low_stock_threshold" type="number" min="0" max="100000" step="1" value="${lowStockThreshold()}" required></label>
        <label>Quantity label<select name="quantity_label">${quantityLabels.map(item=>option(item,quantityLabel())).join('')}</select></label>
        <label>SKU prefix<input name="sku_prefix" pattern="[A-Za-z0-9-]{1,16}" maxlength="16" placeholder="e.g. GL" value="${esc(org.sku_prefix||'')}"></label>
        <label>Batch prefix<input name="batch_prefix" pattern="[A-Za-z0-9-]{1,16}" maxlength="16" placeholder="e.g. BATCH" value="${esc(org.batch_prefix||'')}"></label>
      </div><p class="report-note">Prefixes are shown as suggestions when adding products or receiving inventory. Currency changes display formatting only; stored values are not converted.</p></section>
      <button class="btn primary settings-save" type="submit">Save business settings</button>
    </form>`;
  }
  async function save(event){
    event.preventDefault();const button=event.currentTarget.querySelector('button[type="submit"]');const form=new FormData(event.currentTarget);const field=clean(form);
    const payload={target_organization_id:organization().id,target_name:field('name'),target_business_type:field('business_type'),target_contact_email:field('contact_email'),target_contact_phone:field('contact_phone'),target_address_line_1:field('address_line_1'),target_address_line_2:field('address_line_2'),target_city:field('city'),target_region:field('region'),target_postal_code:field('postal_code'),target_country_code:field('country_code').toUpperCase(),target_website_url:field('website_url'),target_currency_code:field('currency_code').toUpperCase(),target_timezone:field('timezone'),target_low_stock_threshold:Number(field('low_stock_threshold')),target_quantity_label:field('quantity_label'),target_sku_prefix:field('sku_prefix').toUpperCase(),target_batch_prefix:field('batch_prefix').toUpperCase()};
    if(!payload.target_name||!Number.isInteger(payload.target_low_stock_threshold)||payload.target_low_stock_threshold<0)return showToast('Check the business settings and try again');
    button.disabled=true;const {data,error}=await LedgerAuth.client.rpc('update_organization_settings',payload);button.disabled=false;
    if(error)return showToast(error.message);Object.assign(organization(),data);render();showToast('Business settings saved');
  }
  window.WorkspaceSettings={lowStockThreshold,currencyCode,quantityLabel,money,save,renderMarkup};
})();
