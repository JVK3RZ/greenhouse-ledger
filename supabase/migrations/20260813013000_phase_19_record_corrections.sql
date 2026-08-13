-- Greenhouse Ledger Phase 19: manager-controlled record corrections with immutable audit history.

revoke update on table public.plant_catalog, public.inventory_batches from authenticated;

create or replace function public.correct_catalog_product(
  target_product_id uuid,
  target_common_name text,
  target_scientific_name text,
  target_cultivar text,
  target_container_size text,
  target_sku text,
  target_default_price numeric,
  target_watering_days integer,
  target_feeding_days integer
)
returns public.plant_catalog
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  original public.plant_catalog;
  corrected public.plant_catalog;
begin
  select * into original from public.plant_catalog where id = target_product_id for update;
  if original.id is null then raise exception 'Catalog product not found'; end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = original.organization_id
      and member.profile_id = actor
      and member.role in ('owner','manager')
  ) then raise exception 'Owner or manager access required'; end if;
  if nullif(btrim(target_common_name),'') is null then raise exception 'Common name is required'; end if;
  if target_default_price is not null and target_default_price < 0 then raise exception 'Default price cannot be negative'; end if;
  if target_watering_days is not null and target_watering_days < 1 then raise exception 'Watering days must be positive'; end if;
  if target_feeding_days is not null and target_feeding_days < 1 then raise exception 'Feeding days must be positive'; end if;

  update public.plant_catalog set
    common_name = btrim(target_common_name),
    scientific_name = nullif(btrim(target_scientific_name),''),
    cultivar = nullif(btrim(target_cultivar),''),
    container_size = nullif(btrim(target_container_size),''),
    sku = nullif(btrim(target_sku),''),
    default_price = target_default_price,
    watering_days = target_watering_days,
    feeding_days = target_feeding_days
  where id = target_product_id
  returning * into corrected;

  insert into public.activity_logs (organization_id,actor_id,entity_type,entity_id,action,details)
  values (
    original.organization_id,actor,'plant_catalog',original.id,'catalog_product_corrected',
    jsonb_build_object(
      'before',to_jsonb(original) - array['organization_id','created_at','updated_at'],
      'after',to_jsonb(corrected) - array['organization_id','created_at','updated_at']
    )
  );
  return corrected;
end;
$$;

create or replace function public.set_catalog_product_status(target_product_id uuid, target_status text)
returns public.plant_catalog
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  original public.plant_catalog;
  corrected public.plant_catalog;
begin
  select * into original from public.plant_catalog where id = target_product_id for update;
  if original.id is null then raise exception 'Catalog product not found'; end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = original.organization_id
      and member.profile_id = actor
      and member.role in ('owner','manager')
  ) then raise exception 'Owner or manager access required'; end if;
  if target_status not in ('active','archived') then raise exception 'Status must be active or archived'; end if;
  update public.plant_catalog set status = target_status where id = target_product_id returning * into corrected;
  insert into public.activity_logs (organization_id,actor_id,entity_type,entity_id,action,details)
  values (original.organization_id,actor,'plant_catalog',original.id,'catalog_product_status_changed',jsonb_build_object('before',original.status,'after',corrected.status));
  return corrected;
end;
$$;

create or replace function public.correct_inventory_batch(
  target_batch_id uuid,
  target_location_id uuid,
  target_stage public.inventory_stage,
  target_batch_code text,
  target_unit_cost numeric,
  target_unit_price numeric,
  target_acquired_on date,
  target_notes text
)
returns public.inventory_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  original public.inventory_batches;
  corrected public.inventory_batches;
begin
  select * into original from public.inventory_batches where id = target_batch_id for update;
  if original.id is null then raise exception 'Inventory batch not found'; end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = original.organization_id
      and member.profile_id = actor
      and member.role in ('owner','manager')
  ) then raise exception 'Owner or manager access required'; end if;
  if target_location_id is not null and not exists (
    select 1 from public.locations location
    where location.id = target_location_id and location.organization_id = original.organization_id
  ) then raise exception 'Production zone belongs to a different organization'; end if;
  if target_unit_cost is not null and target_unit_cost < 0 then raise exception 'Unit cost cannot be negative'; end if;
  if target_unit_price is not null and target_unit_price < 0 then raise exception 'Unit price cannot be negative'; end if;

  update public.inventory_batches set
    location_id = target_location_id,
    stage = target_stage,
    batch_code = nullif(btrim(target_batch_code),''),
    unit_cost = target_unit_cost,
    unit_price = target_unit_price,
    acquired_on = target_acquired_on,
    notes = nullif(btrim(target_notes),'')
  where id = target_batch_id
  returning * into corrected;

  insert into public.activity_logs (organization_id,actor_id,entity_type,entity_id,action,details)
  values (
    original.organization_id,actor,'inventory_batch',original.id,'inventory_batch_corrected',
    jsonb_build_object(
      'before',to_jsonb(original) - array['organization_id','quantity','photo_path','created_at','updated_at'],
      'after',to_jsonb(corrected) - array['organization_id','quantity','photo_path','created_at','updated_at']
    )
  );
  return corrected;
end;
$$;

create or replace function public.set_inventory_batch_photo(target_batch_id uuid, target_photo_path text)
returns public.inventory_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  batch public.inventory_batches;
begin
  select * into batch from public.inventory_batches where id = target_batch_id for update;
  if batch.id is null then raise exception 'Inventory batch not found'; end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = batch.organization_id and member.profile_id = actor
  ) then raise exception 'Organization membership required'; end if;
  if target_photo_path is null or target_photo_path not like batch.organization_id::text || '/batches/' || batch.id::text || '/%' then
    raise exception 'Photo path must belong to this inventory batch';
  end if;
  update public.inventory_batches set photo_path = target_photo_path where id = target_batch_id returning * into batch;
  return batch;
end;
$$;

revoke all on function public.correct_catalog_product(uuid,text,text,text,text,text,numeric,integer,integer) from public, anon;
revoke all on function public.set_catalog_product_status(uuid,text) from public, anon;
revoke all on function public.correct_inventory_batch(uuid,uuid,public.inventory_stage,text,numeric,numeric,date,text) from public, anon;
revoke all on function public.set_inventory_batch_photo(uuid,text) from public, anon;
grant execute on function public.correct_catalog_product(uuid,text,text,text,text,text,numeric,integer,integer) to authenticated;
grant execute on function public.set_catalog_product_status(uuid,text) to authenticated;
grant execute on function public.correct_inventory_batch(uuid,uuid,public.inventory_stage,text,numeric,numeric,date,text) to authenticated;
grant execute on function public.set_inventory_batch_photo(uuid,text) to authenticated;
