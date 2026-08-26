-- Greenhouse Ledger Phase 26: opt-in care schedules during inventory receiving.
create or replace function public.receive_inventory_batch_with_care(
  target_organization_id uuid, target_plant_catalog_id uuid, target_location_id uuid,
  starting_quantity integer, target_stage public.inventory_stage default 'vegetative',
  target_batch_code text default null, target_unit_cost numeric default null,
  target_unit_price numeric default null, create_care_tasks boolean default false
) returns public.inventory_batches language plpgsql security definer set search_path = '' as $$
declare received public.inventory_batches; catalog public.plant_catalog;
begin
  if (select auth.uid()) is null or not exists (select 1 from public.organization_members where organization_id=target_organization_id and profile_id=(select auth.uid())) then raise exception 'Organization membership required'; end if;
  select * into catalog from public.plant_catalog where id=target_plant_catalog_id and organization_id=target_organization_id;
  if catalog.id is null then raise exception 'Catalog plant does not belong to this organization'; end if;
  select * into received from public.receive_inventory_batch(target_organization_id,target_plant_catalog_id,target_location_id,starting_quantity,target_stage,target_batch_code,target_unit_cost,target_unit_price);
  if create_care_tasks and catalog.watering_days is not null then
    insert into public.care_tasks(organization_id,batch_id,location_id,task_type,title,notes,due_at,recurrence_days)
    values(target_organization_id,received.id,target_location_id,'watering','Water '||catalog.common_name,'Automatically scheduled from the catalog care interval.',received.acquired_on::timestamptz+make_interval(days=>catalog.watering_days),catalog.watering_days);
  end if;
  if create_care_tasks and catalog.feeding_days is not null then
    insert into public.care_tasks(organization_id,batch_id,location_id,task_type,title,notes,due_at,recurrence_days)
    values(target_organization_id,received.id,target_location_id,'feeding','Feed '||catalog.common_name,'Automatically scheduled from the catalog care interval.',received.acquired_on::timestamptz+make_interval(days=>catalog.feeding_days),catalog.feeding_days);
  end if;
  return received;
end; $$;

create or replace function public.bulk_receive_inventory_with_care(target_organization_id uuid,receipt_items jsonb)
returns setof public.inventory_batches language plpgsql security definer set search_path = '' as $$
declare item jsonb; received public.inventory_batches;
begin
  if (select auth.uid()) is null or not exists (select 1 from public.organization_members where organization_id=target_organization_id and profile_id=(select auth.uid())) then raise exception 'Organization membership required'; end if;
  if jsonb_typeof(receipt_items)<>'array' or jsonb_array_length(receipt_items)<1 or jsonb_array_length(receipt_items)>100 then raise exception 'Bulk receipt must contain between 1 and 100 items'; end if;
  for item in select value from jsonb_array_elements(receipt_items) loop
    select * into received from public.receive_inventory_batch_with_care(target_organization_id,(item->>'plant_catalog_id')::uuid,(item->>'location_id')::uuid,(item->>'quantity')::integer,coalesce(nullif(item->>'stage',''),'vegetative')::public.inventory_stage,nullif(trim(item->>'batch_code'),''),nullif(item->>'unit_cost','')::numeric,nullif(item->>'unit_price','')::numeric,coalesce((item->>'create_care_tasks')::boolean,false));
    return next received;
  end loop;
end; $$;

revoke all on function public.receive_inventory_batch_with_care(uuid,uuid,uuid,integer,public.inventory_stage,text,numeric,numeric,boolean) from public,anon;
revoke all on function public.bulk_receive_inventory_with_care(uuid,jsonb) from public,anon;
grant execute on function public.receive_inventory_batch_with_care(uuid,uuid,uuid,integer,public.inventory_stage,text,numeric,numeric,boolean) to authenticated;
grant execute on function public.bulk_receive_inventory_with_care(uuid,jsonb) to authenticated;
