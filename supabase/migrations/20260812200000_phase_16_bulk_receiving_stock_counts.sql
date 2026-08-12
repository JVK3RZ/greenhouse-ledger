-- Greenhouse Ledger Phase 16: atomic bulk receiving and auditable physical stock counts.
create type public.inventory_count_status as enum ('draft', 'completed', 'cancelled');

create table public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid references public.locations(id) on delete restrict,
  status public.inventory_count_status not null default 'draft',
  notes text,
  started_by uuid not null default auth.uid() references public.profiles(id),
  completed_by uuid references public.profiles(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.inventory_count_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inventory_count_id uuid not null references public.inventory_counts(id) on delete cascade,
  batch_id uuid not null references public.inventory_batches(id) on delete restrict,
  expected_quantity integer not null check (expected_quantity >= 0),
  counted_quantity integer check (counted_quantity is null or counted_quantity >= 0),
  counted_by uuid references public.profiles(id),
  counted_at timestamptz,
  unique (inventory_count_id, batch_id)
);

create unique index inventory_counts_one_draft_per_org_idx
  on public.inventory_counts (organization_id) where status = 'draft';
create index inventory_counts_organization_started_idx
  on public.inventory_counts (organization_id, started_at desc);
create index inventory_count_lines_count_idx
  on public.inventory_count_lines (inventory_count_id);
create index inventory_count_lines_batch_idx
  on public.inventory_count_lines (batch_id);

alter table public.inventory_counts enable row level security;
alter table public.inventory_count_lines enable row level security;

create policy inventory_counts_member_select on public.inventory_counts
  for select to authenticated using (private.is_organization_member(organization_id));
create policy inventory_count_lines_member_select on public.inventory_count_lines
  for select to authenticated using (private.is_organization_member(organization_id));

grant select on public.inventory_counts, public.inventory_count_lines to authenticated;

create or replace function public.bulk_receive_inventory(
  target_organization_id uuid,
  receipt_items jsonb
)
returns setof public.inventory_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  received public.inventory_batches;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.organization_members
    where organization_id = target_organization_id and profile_id = (select auth.uid())
  ) then
    raise exception 'Organization membership required';
  end if;
  if jsonb_typeof(receipt_items) <> 'array' or jsonb_array_length(receipt_items) < 1 or jsonb_array_length(receipt_items) > 100 then
    raise exception 'Bulk receipt must contain between 1 and 100 items';
  end if;
  for item in select value from jsonb_array_elements(receipt_items)
  loop
    select * into received from public.receive_inventory_batch(
      target_organization_id,
      (item->>'plant_catalog_id')::uuid,
      (item->>'location_id')::uuid,
      (item->>'quantity')::integer,
      coalesce(nullif(item->>'stage',''),'vegetative')::public.inventory_stage,
      nullif(trim(item->>'batch_code'),''),
      nullif(item->>'unit_cost','')::numeric,
      nullif(item->>'unit_price','')::numeric
    );
    return next received;
  end loop;
end;
$$;

create or replace function public.start_inventory_count(
  target_organization_id uuid,
  target_location_id uuid default null,
  count_notes text default null
)
returns public.inventory_counts
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_count public.inventory_counts;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.organization_members
    where organization_id = target_organization_id and profile_id = (select auth.uid())
  ) then
    raise exception 'Organization membership required';
  end if;
  if target_location_id is not null and not exists (
    select 1 from public.locations where id = target_location_id and organization_id = target_organization_id
  ) then
    raise exception 'Location does not belong to this organization';
  end if;
  insert into public.inventory_counts (organization_id, location_id, notes)
  values (target_organization_id, target_location_id, nullif(trim(count_notes),''))
  returning * into new_count;

  insert into public.inventory_count_lines
    (organization_id, inventory_count_id, batch_id, expected_quantity)
  select target_organization_id, new_count.id, batch.id, batch.quantity
  from public.inventory_batches batch
  where batch.organization_id = target_organization_id
    and (target_location_id is null or batch.location_id = target_location_id);

  if not found then
    raise exception 'No inventory batches are available for this count';
  end if;
  return new_count;
end;
$$;

create or replace function public.record_inventory_count(
  target_count_id uuid,
  target_batch_id uuid,
  physical_quantity integer
)
returns public.inventory_count_lines
language plpgsql
security definer
set search_path = ''
as $$
declare
  count_row public.inventory_counts;
  updated_line public.inventory_count_lines;
begin
  if physical_quantity < 0 then raise exception 'Counted quantity cannot be negative'; end if;
  select * into count_row from public.inventory_counts where id = target_count_id;
  if count_row.id is null or (select auth.uid()) is null or not exists (
    select 1 from public.organization_members
    where organization_id = count_row.organization_id and profile_id = (select auth.uid())
  ) then
    raise exception 'Inventory count not found';
  end if;
  if count_row.status <> 'draft' then raise exception 'Only draft counts can be updated'; end if;
  update public.inventory_count_lines
  set counted_quantity = physical_quantity, counted_by = (select auth.uid()), counted_at = now()
  where inventory_count_id = target_count_id and batch_id = target_batch_id
  returning * into updated_line;
  if updated_line.id is null then raise exception 'Count line not found'; end if;
  return updated_line;
end;
$$;

create or replace function public.finalize_inventory_count(target_count_id uuid)
returns public.inventory_counts
language plpgsql
security definer
set search_path = ''
as $$
declare
  count_row public.inventory_counts;
  line record;
begin
  select * into count_row from public.inventory_counts where id = target_count_id for update;
  if count_row.id is null then raise exception 'Inventory count not found'; end if;
  if (select auth.uid()) is null or not exists (
    select 1 from public.organization_members
    where organization_id = count_row.organization_id
      and profile_id = (select auth.uid()) and role in ('owner','manager')
  ) then
    raise exception 'Owner or manager approval required';
  end if;
  if count_row.status <> 'draft' then raise exception 'Only draft counts can be finalized'; end if;
  if exists (
    select 1 from public.inventory_count_lines
    where inventory_count_id = target_count_id and counted_quantity is null
  ) then raise exception 'Every batch must be counted before approval'; end if;

  for line in
    select * from public.inventory_count_lines where inventory_count_id = target_count_id for update
  loop
    if line.counted_quantity <> line.expected_quantity then
      update public.inventory_batches
      set quantity = line.counted_quantity
      where id = line.batch_id and organization_id = count_row.organization_id;
      insert into public.inventory_transactions
        (organization_id, batch_id, transaction_type, quantity, note, performed_by)
      values (
        count_row.organization_id, line.batch_id, 'adjustment',
        abs(line.counted_quantity - line.expected_quantity),
        'Physical stock count ' || target_count_id::text,
        (select auth.uid())
      );
    end if;
  end loop;

  update public.inventory_counts
  set status = 'completed', completed_by = (select auth.uid()), completed_at = now()
  where id = target_count_id returning * into count_row;
  insert into public.activity_logs (organization_id, actor_id, entity_type, entity_id, action, details)
  values (
    count_row.organization_id, (select auth.uid()), 'inventory_count', count_row.id,
    'inventory_count_completed',
    jsonb_build_object('location_id', count_row.location_id)
  );
  return count_row;
end;
$$;

create or replace function public.cancel_inventory_count(target_count_id uuid)
returns public.inventory_counts
language plpgsql
security definer
set search_path = ''
as $$
declare
  count_row public.inventory_counts;
begin
  select * into count_row from public.inventory_counts where id = target_count_id for update;
  if count_row.id is null then raise exception 'Inventory count not found'; end if;
  if (select auth.uid()) is null or not exists (
    select 1 from public.organization_members
    where organization_id = count_row.organization_id
      and profile_id = (select auth.uid()) and role in ('owner','manager')
  ) then
    raise exception 'Owner or manager approval required';
  end if;
  if count_row.status <> 'draft' then raise exception 'Only draft counts can be cancelled'; end if;
  update public.inventory_counts set status = 'cancelled', completed_by = (select auth.uid()), completed_at = now()
  where id = target_count_id returning * into count_row;
  return count_row;
end;
$$;

revoke all on function public.bulk_receive_inventory(uuid,jsonb) from public, anon;
revoke all on function public.start_inventory_count(uuid,uuid,text) from public, anon;
revoke all on function public.record_inventory_count(uuid,uuid,integer) from public, anon;
revoke all on function public.finalize_inventory_count(uuid) from public, anon;
revoke all on function public.cancel_inventory_count(uuid) from public, anon;
grant execute on function public.bulk_receive_inventory(uuid,jsonb) to authenticated;
grant execute on function public.start_inventory_count(uuid,uuid,text) to authenticated;
grant execute on function public.record_inventory_count(uuid,uuid,integer) to authenticated;
grant execute on function public.finalize_inventory_count(uuid) to authenticated;
grant execute on function public.cancel_inventory_count(uuid) to authenticated;
