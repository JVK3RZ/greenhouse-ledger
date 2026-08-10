-- Prevent cross-organization catalog or location references during batch receipt.
create or replace function public.receive_inventory_batch(
  target_organization_id uuid,
  target_plant_catalog_id uuid,
  target_location_id uuid,
  starting_quantity integer,
  target_stage public.inventory_stage default 'vegetative',
  target_batch_code text default null,
  target_unit_cost numeric default null,
  target_unit_price numeric default null
)
returns public.inventory_batches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_batch public.inventory_batches;
begin
  if starting_quantity <= 0 then raise exception 'Starting quantity must be greater than zero'; end if;
  if not exists (select 1 from public.plant_catalog where id = target_plant_catalog_id and organization_id = target_organization_id) then
    raise exception 'Catalog plant does not belong to this organization';
  end if;
  if not exists (select 1 from public.locations where id = target_location_id and organization_id = target_organization_id) then
    raise exception 'Location does not belong to this organization';
  end if;
  insert into public.inventory_batches (
    organization_id,plant_catalog_id,location_id,batch_code,stage,quantity,unit_cost,unit_price,acquired_on
  ) values (
    target_organization_id,target_plant_catalog_id,target_location_id,nullif(trim(target_batch_code),''),
    target_stage,starting_quantity,target_unit_cost,target_unit_price,current_date
  ) returning * into new_batch;
  insert into public.inventory_transactions (organization_id,batch_id,transaction_type,quantity,note)
  values (target_organization_id,new_batch.id,'received',starting_quantity,'Initial receipt');
  return new_batch;
end;
$$;

revoke all on function public.receive_inventory_batch(uuid,uuid,uuid,integer,public.inventory_stage,text,numeric,numeric) from public, anon;
grant execute on function public.receive_inventory_batch(uuid,uuid,uuid,integer,public.inventory_stage,text,numeric,numeric) to authenticated;
