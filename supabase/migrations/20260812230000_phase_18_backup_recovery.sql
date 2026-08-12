-- Greenhouse Ledger Phase 18: additive, owner-controlled backup recovery.
create table public.backup_recovery_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  backup_exported_at timestamptz not null,
  backup_checksum text,
  restored_counts jsonb not null default '{}'::jsonb,
  restored_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index backup_recovery_runs_org_created_idx on public.backup_recovery_runs (organization_id, created_at desc);
create index backup_recovery_runs_restored_by_idx on public.backup_recovery_runs (restored_by);
alter table public.backup_recovery_runs enable row level security;
create policy backup_recovery_runs_manager_select on public.backup_recovery_runs for select to authenticated
using (private.has_organization_role(organization_id,array['owner','manager']::public.organization_role[]));
revoke all on table public.backup_recovery_runs from public, anon, authenticated;
grant select on table public.backup_recovery_runs to authenticated;

create or replace function public.restore_cloud_backup(target_organization_id uuid, backup jsonb)
returns public.backup_recovery_runs language plpgsql security definer set search_path='' as $$
declare
  actor uuid := (select auth.uid()); item jsonb; restored integer; summary jsonb := '{}'::jsonb; run public.backup_recovery_runs;
begin
  if actor is null or not exists (
    select 1 from public.organization_members member where member.organization_id=target_organization_id
      and member.profile_id=actor and member.role='owner'
  ) then raise exception 'Organization owner access required'; end if;
  if backup->>'format' <> 'greenhouse-ledger-cloud-backup' or (backup->>'version')::integer <> 2 then
    raise exception 'Unsupported cloud backup format';
  end if;
  if backup#>>'{organization,id}' <> target_organization_id::text then raise exception 'Backup belongs to a different organization'; end if;
  if jsonb_typeof(backup->'data') <> 'object' then raise exception 'Backup data is missing'; end if;

  -- Locations are restored parent-free first so parent ordering cannot break recovery.
  restored:=0;
  for item in select value from jsonb_array_elements(coalesce(backup#>'{data,locations}','[]'::jsonb)) loop
    if item->>'organization_id' <> target_organization_id::text then raise exception 'Backup contains foreign organization data'; end if;
    insert into public.locations (id,organization_id,parent_id,name,location_type,notes,created_at,updated_at)
    values ((item->>'id')::uuid,target_organization_id,null,item->>'name',coalesce(item->>'location_type','zone'),item->>'notes',coalesce((item->>'created_at')::timestamptz,now()),coalesce((item->>'updated_at')::timestamptz,now()))
    on conflict do nothing; if found then restored:=restored+1; end if;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(backup#>'{data,locations}','[]'::jsonb)) loop
    if nullif(item->>'parent_id','') is not null and exists(select 1 from public.locations where id=(item->>'parent_id')::uuid and organization_id=target_organization_id)
    then update public.locations set parent_id=(item->>'parent_id')::uuid where id=(item->>'id')::uuid and organization_id=target_organization_id and parent_id is null; end if;
  end loop;
  summary:=summary||jsonb_build_object('locations',restored);

  restored:=0;
  for item in select value from jsonb_array_elements(coalesce(backup#>'{data,plant_catalog}','[]'::jsonb)) loop
    if item->>'organization_id' <> target_organization_id::text then raise exception 'Backup contains foreign organization data'; end if;
    insert into public.plant_catalog select (jsonb_populate_record(null::public.plant_catalog,item)).* on conflict do nothing;
    if found then restored:=restored+1; end if;
  end loop; summary:=summary||jsonb_build_object('plant_catalog',restored);

  restored:=0;
  for item in select value from jsonb_array_elements(coalesce(backup#>'{data,inventory_batches}','[]'::jsonb)) loop
    if item->>'organization_id' <> target_organization_id::text then raise exception 'Backup contains foreign organization data'; end if;
    insert into public.inventory_batches select (jsonb_populate_record(null::public.inventory_batches,item)).* on conflict do nothing;
    if found then restored:=restored+1; end if;
  end loop; summary:=summary||jsonb_build_object('inventory_batches',restored);

  restored:=0;
  for item in select value from jsonb_array_elements(coalesce(backup#>'{data,inventory_transactions}','[]'::jsonb)) loop
    if item->>'organization_id' <> target_organization_id::text then raise exception 'Backup contains foreign organization data'; end if;
    insert into public.inventory_transactions select (jsonb_populate_record(null::public.inventory_transactions,item)).* on conflict do nothing;
    if found then restored:=restored+1; end if;
  end loop; summary:=summary||jsonb_build_object('inventory_transactions',restored);

  restored:=0;
  for item in select value from jsonb_array_elements(coalesce(backup#>'{data,care_tasks}','[]'::jsonb)) loop
    if item->>'organization_id' <> target_organization_id::text then raise exception 'Backup contains foreign organization data'; end if;
    insert into public.care_tasks select (jsonb_populate_record(null::public.care_tasks,item)).* on conflict do nothing;
    if found then restored:=restored+1; end if;
  end loop; summary:=summary||jsonb_build_object('care_tasks',restored);

  restored:=0;
  for item in select value from jsonb_array_elements(coalesce(backup#>'{data,inventory_counts}','[]'::jsonb)) loop
    if item->>'organization_id' <> target_organization_id::text then raise exception 'Backup contains foreign organization data'; end if;
    insert into public.inventory_counts select (jsonb_populate_record(null::public.inventory_counts,item)).* on conflict do nothing;
    if found then restored:=restored+1; end if;
  end loop; summary:=summary||jsonb_build_object('inventory_counts',restored);

  restored:=0;
  for item in select value from jsonb_array_elements(coalesce(backup#>'{data,inventory_count_lines}','[]'::jsonb)) loop
    if item->>'organization_id' <> target_organization_id::text then raise exception 'Backup contains foreign organization data'; end if;
    insert into public.inventory_count_lines select (jsonb_populate_record(null::public.inventory_count_lines,item)).* on conflict do nothing;
    if found then restored:=restored+1; end if;
  end loop; summary:=summary||jsonb_build_object('inventory_count_lines',restored);

  restored:=0;
  for item in select value from jsonb_array_elements(coalesce(backup#>'{data,plant_health_issues}','[]'::jsonb)) loop
    if item->>'organization_id' <> target_organization_id::text then raise exception 'Backup contains foreign organization data'; end if;
    insert into public.plant_health_issues select (jsonb_populate_record(null::public.plant_health_issues,item)).* on conflict do nothing;
    if found then restored:=restored+1; end if;
  end loop; summary:=summary||jsonb_build_object('plant_health_issues',restored);

  restored:=0;
  for item in select value from jsonb_array_elements(coalesce(backup#>'{data,plant_health_issue_updates}','[]'::jsonb)) loop
    if item->>'organization_id' <> target_organization_id::text then raise exception 'Backup contains foreign organization data'; end if;
    insert into public.plant_health_issue_updates select (jsonb_populate_record(null::public.plant_health_issue_updates,item)).* on conflict do nothing;
    if found then restored:=restored+1; end if;
  end loop; summary:=summary||jsonb_build_object('plant_health_issue_updates',restored);

  insert into public.backup_recovery_runs (organization_id,backup_exported_at,backup_checksum,restored_counts,restored_by)
  values (target_organization_id,(backup->>'exported_at')::timestamptz,backup#>>'{integrity,checksum}',summary,actor) returning * into run;
  insert into public.activity_logs (organization_id,actor_id,entity_type,entity_id,action,details)
  values (target_organization_id,actor,'backup_recovery',run.id,'backup_recovery_completed',summary);
  return run;
end; $$;

revoke all on function public.restore_cloud_backup(uuid,jsonb) from public, anon;
grant execute on function public.restore_cloud_backup(uuid,jsonb) to authenticated;
