-- Greenhouse Ledger Phase 2: atomic, tenant-checked stock adjustments
create or replace function public.adjust_inventory_stock(
  target_batch_id uuid,
  stock_delta integer,
  kind public.inventory_transaction_type,
  stock_note text default null
)
returns public.inventory_batches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_batch public.inventory_batches;
  updated_batch public.inventory_batches;
begin
  if stock_delta = 0 then raise exception 'Stock change cannot be zero'; end if;
  if kind in ('received','propagation','transfer_in') and stock_delta < 0 then raise exception 'This transaction type must increase stock'; end if;
  if kind in ('sale','loss','transfer_out') and stock_delta > 0 then raise exception 'This transaction type must decrease stock'; end if;

  select * into current_batch from public.inventory_batches where id = target_batch_id for update;
  if current_batch.id is null then raise exception 'Inventory batch not found'; end if;
  if current_batch.quantity + stock_delta < 0 then raise exception 'Stock cannot fall below zero'; end if;

  update public.inventory_batches set quantity = quantity + stock_delta where id = target_batch_id returning * into updated_batch;
  insert into public.inventory_transactions (organization_id,batch_id,transaction_type,quantity,note)
  values (current_batch.organization_id,target_batch_id,kind,abs(stock_delta),nullif(trim(stock_note),''));
  return updated_batch;
end;
$$;

revoke all on function public.adjust_inventory_stock(uuid,integer,public.inventory_transaction_type,text) from public, anon;
grant execute on function public.adjust_inventory_stock(uuid,integer,public.inventory_transaction_type,text) to authenticated;

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
