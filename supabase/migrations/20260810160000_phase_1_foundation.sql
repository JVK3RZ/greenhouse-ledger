-- Greenhouse Ledger Phase 1: multi-tenant commercial foundation
create extension if not exists pgcrypto;

create type public.organization_role as enum ('owner', 'manager', 'worker');
create type public.inventory_stage as enum ('propagation', 'seedling', 'vegetative', 'finishing', 'retail_ready', 'dormant');
create type public.inventory_transaction_type as enum ('received', 'sale', 'loss', 'propagation', 'adjustment', 'transfer_in', 'transfer_out');
create type public.care_task_status as enum ('open', 'in_progress', 'completed', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.organization_role not null default 'worker',
  created_at timestamptz not null default now(),
  primary key (organization_id, profile_id)
);
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id uuid references public.locations(id) on delete set null,
  name text not null check (char_length(trim(name)) between 1 and 120),
  location_type text not null default 'zone',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.plant_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  common_name text not null,
  scientific_name text,
  cultivar text,
  sku text,
  default_price numeric(12,2) check (default_price is null or default_price >= 0),
  watering_days integer check (watering_days is null or watering_days > 0),
  feeding_days integer check (feeding_days is null or feeding_days > 0),
  care_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, sku)
);
create table public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plant_catalog_id uuid not null references public.plant_catalog(id) on delete restrict,
  location_id uuid references public.locations(id) on delete set null,
  batch_code text,
  stage public.inventory_stage not null default 'vegetative',
  quantity integer not null default 0 check (quantity >= 0),
  unit_cost numeric(12,2) check (unit_cost is null or unit_cost >= 0),
  unit_price numeric(12,2) check (unit_price is null or unit_price >= 0),
  acquired_on date,
  last_watered_at timestamptz,
  last_fed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, batch_code)
);
create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null references public.inventory_batches(id) on delete restrict,
  destination_batch_id uuid references public.inventory_batches(id) on delete restrict,
  transaction_type public.inventory_transaction_type not null,
  quantity integer not null check (quantity > 0),
  note text,
  performed_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.care_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid references public.inventory_batches(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  task_type text not null,
  title text not null,
  notes text,
  due_at timestamptz,
  assigned_to uuid references public.profiles(id) on delete set null,
  status public.care_task_status not null default 'open',
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.activity_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create or replace function private.is_organization_member(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.organization_members member
    where member.organization_id = target_organization_id
      and member.profile_id = (select auth.uid())
  );
$$;
create or replace function private.has_organization_role(target_organization_id uuid, allowed_roles public.organization_role[])
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.organization_members member
    where member.organization_id = target_organization_id
      and member.profile_id = (select auth.uid())
      and member.role = any(allowed_roles)
  );
$$;
create or replace function private.is_organization_creator(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.organizations organization
    where organization.id = target_organization_id
      and organization.created_by = (select auth.uid())
  );
$$;
revoke all on function private.is_organization_member(uuid) from public, anon, authenticated;
revoke all on function private.has_organization_role(uuid, public.organization_role[]) from public, anon, authenticated;
revoke all on function private.is_organization_creator(uuid) from public, anon, authenticated;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end; $$;
create trigger profiles_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger organizations_updated_at before update on public.organizations for each row execute function private.set_updated_at();
create trigger locations_updated_at before update on public.locations for each row execute function private.set_updated_at();
create trigger plant_catalog_updated_at before update on public.plant_catalog for each row execute function private.set_updated_at();
create trigger inventory_batches_updated_at before update on public.inventory_batches for each row execute function private.set_updated_at();
create trigger care_tasks_updated_at before update on public.care_tasks for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.locations enable row level security;
alter table public.plant_catalog enable row level security;
alter table public.inventory_batches enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.care_tasks enable row level security;
alter table public.activity_logs enable row level security;

create policy profiles_select_self on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_update_self on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy organizations_select_member on public.organizations for select to authenticated using (private.is_organization_member(id));
create policy organizations_insert_owner on public.organizations for insert to authenticated with check ((select auth.uid()) = created_by);
create policy organizations_update_manager on public.organizations for update to authenticated
  using (private.has_organization_role(id, array['owner','manager']::public.organization_role[]))
  with check (private.has_organization_role(id, array['owner','manager']::public.organization_role[]));
create policy members_select_member on public.organization_members for select to authenticated using (private.is_organization_member(organization_id));
create policy members_bootstrap_or_manage on public.organization_members for insert to authenticated
  with check (
    (profile_id = (select auth.uid()) and role = 'owner' and private.is_organization_creator(organization_id))
    or private.has_organization_role(organization_id, array['owner','manager']::public.organization_role[])
  );
create policy members_update_manager on public.organization_members for update to authenticated
  using (private.has_organization_role(organization_id, array['owner','manager']::public.organization_role[]))
  with check (private.has_organization_role(organization_id, array['owner','manager']::public.organization_role[]));
create policy members_delete_owner on public.organization_members for delete to authenticated
  using (private.has_organization_role(organization_id, array['owner']::public.organization_role[]));
create policy locations_member_all on public.locations for all to authenticated using (private.is_organization_member(organization_id)) with check (private.is_organization_member(organization_id));
create policy catalog_member_all on public.plant_catalog for all to authenticated using (private.is_organization_member(organization_id)) with check (private.is_organization_member(organization_id));
create policy batches_member_all on public.inventory_batches for all to authenticated using (private.is_organization_member(organization_id)) with check (private.is_organization_member(organization_id));
create policy transactions_member_select on public.inventory_transactions for select to authenticated using (private.is_organization_member(organization_id));
create policy transactions_member_insert on public.inventory_transactions for insert to authenticated with check (private.is_organization_member(organization_id) and performed_by = (select auth.uid()));
create policy tasks_member_all on public.care_tasks for all to authenticated using (private.is_organization_member(organization_id)) with check (private.is_organization_member(organization_id));
create policy activity_member_select on public.activity_logs for select to authenticated using (private.is_organization_member(organization_id));
create policy activity_member_insert on public.activity_logs for insert to authenticated with check (private.is_organization_member(organization_id) and actor_id = (select auth.uid()));

create index organization_members_profile_idx on public.organization_members(profile_id);
create index locations_organization_idx on public.locations(organization_id);
create index plant_catalog_organization_idx on public.plant_catalog(organization_id);
create index inventory_batches_organization_location_idx on public.inventory_batches(organization_id, location_id);
create index inventory_transactions_batch_created_idx on public.inventory_transactions(batch_id, created_at desc);
create index care_tasks_organization_status_due_idx on public.care_tasks(organization_id, status, due_at);
create index activity_logs_organization_created_idx on public.activity_logs(organization_id, created_at desc);

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles, public.organizations to authenticated;
grant select, insert, update, delete on public.organization_members, public.locations, public.plant_catalog, public.inventory_batches, public.care_tasks to authenticated;
grant select, insert on public.inventory_transactions, public.activity_logs to authenticated;
grant usage, select on sequence public.activity_logs_id_seq to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('greenhouse-photos', 'greenhouse-photos', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy greenhouse_photos_select on storage.objects for select to authenticated using (
  bucket_id = 'greenhouse-photos' and private.is_organization_member(((storage.foldername(name))[1])::uuid)
);
create policy greenhouse_photos_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'greenhouse-photos' and private.is_organization_member(((storage.foldername(name))[1])::uuid)
);
create policy greenhouse_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'greenhouse-photos' and private.is_organization_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'greenhouse-photos' and private.is_organization_member(((storage.foldername(name))[1])::uuid));
create policy greenhouse_photos_delete on storage.objects for delete to authenticated using (
  bucket_id = 'greenhouse-photos'
  and private.has_organization_role(((storage.foldername(name))[1])::uuid, array['owner','manager']::public.organization_role[])
);
