-- Greenhouse Ledger Phase 20: business-ready workspace settings.
alter table public.organizations
  add column business_type text not null default 'greenhouse',
  add column contact_email text,
  add column contact_phone text,
  add column address_line_1 text,
  add column address_line_2 text,
  add column city text,
  add column region text,
  add column postal_code text,
  add column country_code text not null default 'US',
  add column website_url text,
  add column quantity_label text not null default 'units',
  add column sku_prefix text,
  add column batch_prefix text;

alter table public.organizations
  add constraint organizations_business_type_check check (business_type in ('greenhouse','nursery','garden_center','farm','other')),
  add constraint organizations_contact_email_check check (contact_email is null or (char_length(contact_email) between 3 and 254 and contact_email like '%@%')),
  add constraint organizations_contact_phone_check check (contact_phone is null or char_length(contact_phone) between 5 and 40),
  add constraint organizations_address_line_1_check check (address_line_1 is null or char_length(address_line_1) <= 160),
  add constraint organizations_address_line_2_check check (address_line_2 is null or char_length(address_line_2) <= 160),
  add constraint organizations_city_check check (city is null or char_length(city) <= 100),
  add constraint organizations_region_check check (region is null or char_length(region) <= 100),
  add constraint organizations_postal_code_check check (postal_code is null or char_length(postal_code) <= 24),
  add constraint organizations_country_code_check check (country_code ~ '^[A-Z]{2}$'),
  add constraint organizations_website_url_check check (website_url is null or (char_length(website_url) <= 240 and website_url ~ '^https?://')),
  add constraint organizations_quantity_label_check check (quantity_label in ('units','plants','items','pots','trays')),
  add constraint organizations_sku_prefix_check check (sku_prefix is null or sku_prefix ~ '^[A-Z0-9-]{1,16}$'),
  add constraint organizations_batch_prefix_check check (batch_prefix is null or batch_prefix ~ '^[A-Z0-9-]{1,16}$');

comment on column public.organizations.quantity_label is 'Workspace label used when presenting inventory quantities.';
comment on column public.organizations.sku_prefix is 'Optional uppercase prefix suggested for new catalog SKUs.';
comment on column public.organizations.batch_prefix is 'Optional uppercase prefix suggested for new inventory batch codes.';

create or replace function public.update_organization_settings(
  target_organization_id uuid,
  target_name text,
  target_business_type text,
  target_contact_email text,
  target_contact_phone text,
  target_address_line_1 text,
  target_address_line_2 text,
  target_city text,
  target_region text,
  target_postal_code text,
  target_country_code text,
  target_website_url text,
  target_currency_code text,
  target_timezone text,
  target_low_stock_threshold integer,
  target_quantity_label text,
  target_sku_prefix text,
  target_batch_prefix text
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid()); original public.organizations%rowtype; updated public.organizations%rowtype;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  select * into original from public.organizations where id=target_organization_id for update;
  if original.id is null then raise exception 'Organization not found'; end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id=target_organization_id and member.profile_id=actor and member.role in ('owner','manager')
  ) then raise exception 'Owner or manager access required'; end if;

  update public.organizations set
    name=btrim(target_name), business_type=target_business_type,
    contact_email=nullif(lower(btrim(target_contact_email)),''), contact_phone=nullif(btrim(target_contact_phone),''),
    address_line_1=nullif(btrim(target_address_line_1),''), address_line_2=nullif(btrim(target_address_line_2),''),
    city=nullif(btrim(target_city),''), region=nullif(btrim(target_region),''), postal_code=nullif(btrim(target_postal_code),''),
    country_code=upper(btrim(target_country_code)), website_url=nullif(btrim(target_website_url),''),
    currency_code=upper(btrim(target_currency_code)), timezone=btrim(target_timezone),
    low_stock_threshold=target_low_stock_threshold, quantity_label=target_quantity_label,
    sku_prefix=nullif(upper(btrim(target_sku_prefix)),''), batch_prefix=nullif(upper(btrim(target_batch_prefix)),'')
  where id=target_organization_id returning * into updated;

  insert into public.activity_logs (organization_id,actor_id,entity_type,entity_id,action,details)
  values (target_organization_id,actor,'organization',target_organization_id,'organization_settings_updated',
    jsonb_build_object(
      'before',to_jsonb(original) - array['created_by','created_at','updated_at','brand_logo_path'],
      'after',to_jsonb(updated) - array['created_by','created_at','updated_at','brand_logo_path']
    ));
  return updated;
end;
$$;

create or replace function public.update_organization_branding(
  target_organization_id uuid,
  target_brand_primary text,
  target_brand_accent text,
  target_brand_background text,
  target_brand_logo_path text
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid()); original public.organizations%rowtype; updated public.organizations%rowtype;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  select * into original from public.organizations where id=target_organization_id for update;
  if original.id is null then raise exception 'Organization not found'; end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id=target_organization_id and member.profile_id=actor and member.role in ('owner','manager')
  ) then raise exception 'Owner or manager access required'; end if;
  if target_brand_logo_path is not null and target_brand_logo_path not like target_organization_id::text || '/branding/%' then
    raise exception 'Logo path must belong to this organization';
  end if;

  update public.organizations set brand_primary=target_brand_primary,brand_accent=target_brand_accent,
    brand_background=target_brand_background,brand_logo_path=target_brand_logo_path
  where id=target_organization_id returning * into updated;
  insert into public.activity_logs (organization_id,actor_id,entity_type,entity_id,action,details)
  values (target_organization_id,actor,'organization',target_organization_id,'organization_branding_updated',
    jsonb_build_object('before',jsonb_build_object('primary',original.brand_primary,'accent',original.brand_accent,'background',original.brand_background,'has_logo',original.brand_logo_path is not null),
      'after',jsonb_build_object('primary',updated.brand_primary,'accent',updated.brand_accent,'background',updated.brand_background,'has_logo',updated.brand_logo_path is not null)));
  return updated;
end;
$$;

revoke update on table public.organizations from authenticated;
revoke all on function public.update_organization_settings(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,integer,text,text,text) from public,anon;
revoke all on function public.update_organization_branding(uuid,text,text,text,text) from public,anon;
grant execute on function public.update_organization_settings(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,integer,text,text,text) to authenticated;
grant execute on function public.update_organization_branding(uuid,text,text,text,text) to authenticated;
