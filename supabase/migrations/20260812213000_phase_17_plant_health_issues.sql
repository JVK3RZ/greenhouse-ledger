-- Greenhouse Ledger Phase 17: traceable plant-health observations and follow-up.
create type public.plant_health_issue_type as enum ('pest', 'disease', 'damage', 'environmental', 'other');
create type public.plant_health_severity as enum ('low', 'moderate', 'high', 'critical');
create type public.plant_health_status as enum ('open', 'monitoring', 'resolved');

create table public.plant_health_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid references public.inventory_batches(id) on delete restrict,
  location_id uuid references public.locations(id) on delete restrict,
  issue_type public.plant_health_issue_type not null,
  severity public.plant_health_severity not null,
  status public.plant_health_status not null default 'open',
  title text not null check (char_length(btrim(title)) between 3 and 120),
  description text check (description is null or char_length(description) <= 2000),
  photo_path text,
  reported_by uuid not null references public.profiles(id),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (batch_id is not null or location_id is not null),
  check ((status = 'resolved') = (resolved_at is not null))
);

create table public.plant_health_issue_updates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  issue_id uuid not null references public.plant_health_issues(id) on delete cascade,
  status public.plant_health_status not null,
  note text not null check (char_length(btrim(note)) between 2 and 2000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index plant_health_issues_org_status_idx on public.plant_health_issues (organization_id, status, created_at desc);
create index plant_health_issues_batch_idx on public.plant_health_issues (batch_id);
create index plant_health_issues_location_idx on public.plant_health_issues (location_id);
create index plant_health_issues_reported_by_idx on public.plant_health_issues (reported_by);
create index plant_health_issues_resolved_by_idx on public.plant_health_issues (resolved_by);
create index plant_health_issue_updates_org_idx on public.plant_health_issue_updates (organization_id);
create index plant_health_issue_updates_issue_idx on public.plant_health_issue_updates (issue_id, created_at desc);
create index plant_health_issue_updates_created_by_idx on public.plant_health_issue_updates (created_by);

alter table public.plant_health_issues enable row level security;
alter table public.plant_health_issue_updates enable row level security;

create policy plant_health_issues_member_select on public.plant_health_issues
for select to authenticated using (private.is_organization_member(organization_id));

create policy plant_health_issue_updates_member_select on public.plant_health_issue_updates
for select to authenticated using (private.is_organization_member(organization_id));

revoke all on table public.plant_health_issues, public.plant_health_issue_updates from public, anon, authenticated;
grant select on table public.plant_health_issues, public.plant_health_issue_updates to authenticated;

create or replace function public.report_plant_health_issue(
  target_organization_id uuid,
  target_batch_id uuid,
  target_location_id uuid,
  target_issue_type public.plant_health_issue_type,
  target_severity public.plant_health_severity,
  target_title text,
  target_description text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); new_issue_id uuid;
begin
  if actor is null or not exists (
    select 1 from public.organization_members member
    where member.organization_id = target_organization_id and member.profile_id = actor
  ) then raise exception 'Organization membership required'; end if;
  if target_batch_id is null and target_location_id is null then
    raise exception 'Choose a batch or production zone';
  end if;
  if target_batch_id is not null and not exists (
    select 1 from public.inventory_batches batch where batch.id = target_batch_id and batch.organization_id = target_organization_id
  ) then raise exception 'Batch does not belong to this organization'; end if;
  if target_location_id is not null and not exists (
    select 1 from public.locations location where location.id = target_location_id and location.organization_id = target_organization_id
  ) then raise exception 'Production zone does not belong to this organization'; end if;

  insert into public.plant_health_issues (organization_id,batch_id,location_id,issue_type,severity,title,description,reported_by)
  values (target_organization_id,target_batch_id,target_location_id,target_issue_type,target_severity,btrim(target_title),nullif(btrim(target_description),''),actor)
  returning id into new_issue_id;
  insert into public.plant_health_issue_updates (organization_id,issue_id,status,note,created_by)
  values (target_organization_id,new_issue_id,'open','Issue reported',actor);
  insert into public.activity_logs (organization_id,actor_id,entity_type,entity_id,action,details)
  values (target_organization_id,actor,'plant_health_issue',new_issue_id,'plant_health_issue_reported',jsonb_build_object('severity',target_severity,'type',target_issue_type));
  return new_issue_id;
end; $$;

create or replace function public.update_plant_health_issue(
  target_issue_id uuid,
  target_status public.plant_health_status,
  update_note text
) returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); issue_record public.plant_health_issues;
begin
  select * into issue_record from public.plant_health_issues where id = target_issue_id for update;
  if issue_record.id is null then raise exception 'Plant-health issue not found'; end if;
  if actor is null or not exists (
    select 1 from public.organization_members member
    where member.organization_id = issue_record.organization_id and member.profile_id = actor
  ) then raise exception 'Organization membership required'; end if;
  if char_length(btrim(update_note)) < 2 then raise exception 'Add a follow-up note'; end if;

  update public.plant_health_issues set status=target_status,
    resolved_by=case when target_status='resolved' then actor else null end,
    resolved_at=case when target_status='resolved' then now() else null end, updated_at=now()
  where id=target_issue_id;
  insert into public.plant_health_issue_updates (organization_id,issue_id,status,note,created_by)
  values (issue_record.organization_id,target_issue_id,target_status,btrim(update_note),actor);
  insert into public.activity_logs (organization_id,actor_id,entity_type,entity_id,action,details)
  values (issue_record.organization_id,actor,'plant_health_issue',target_issue_id,'plant_health_issue_updated',jsonb_build_object('status',target_status));
end; $$;

create or replace function public.set_plant_health_issue_photo(target_issue_id uuid, target_photo_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); issue_record public.plant_health_issues;
begin
  select * into issue_record from public.plant_health_issues where id=target_issue_id for update;
  if issue_record.id is null then raise exception 'Plant-health issue not found'; end if;
  if actor is null or not exists (
    select 1 from public.organization_members member
    where member.organization_id=issue_record.organization_id and member.profile_id=actor
  ) then raise exception 'Organization membership required'; end if;
  if target_photo_path not like issue_record.organization_id::text || '/issues/' || issue_record.id::text || '/%' then
    raise exception 'Photo path must belong to this issue';
  end if;
  update public.plant_health_issues set photo_path=target_photo_path,updated_at=now() where id=target_issue_id;
end; $$;

revoke all on function public.report_plant_health_issue(uuid,uuid,uuid,public.plant_health_issue_type,public.plant_health_severity,text,text) from public, anon;
revoke all on function public.update_plant_health_issue(uuid,public.plant_health_status,text) from public, anon;
revoke all on function public.set_plant_health_issue_photo(uuid,text) from public, anon;
grant execute on function public.report_plant_health_issue(uuid,uuid,uuid,public.plant_health_issue_type,public.plant_health_severity,text,text) to authenticated;
grant execute on function public.update_plant_health_issue(uuid,public.plant_health_status,text) to authenticated;
grant execute on function public.set_plant_health_issue_photo(uuid,text) to authenticated;
