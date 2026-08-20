-- Greenhouse Ledger Phase 23: platform-owner administration and entitlement enforcement.
create table private.platform_administrators (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.organization_entitlements (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  plan text not null default 'trial' check (plan in ('trial','pilot','starter','growth','custom','complimentary')),
  access_status text not null default 'trialing' check (access_status in ('trialing','active','grace_period','suspended','canceled')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  staff_limit integer not null default 5 check (staff_limit between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (access_status <> 'trialing' or trial_ends_at is not null)
);

create table private.platform_admin_notes (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  note text not null check (char_length(btrim(note)) between 2 and 2000),
  created_at timestamptz not null default now()
);

create table private.platform_admin_audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  reason text,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

revoke all on table private.platform_administrators, private.platform_admin_notes, private.platform_admin_audit_logs from public, anon, authenticated;
revoke all on table public.organization_entitlements from public, anon, authenticated;
alter table public.organization_entitlements enable row level security;

create index platform_admin_notes_organization_created_idx on private.platform_admin_notes(organization_id, created_at desc);
create index platform_admin_notes_author_idx on private.platform_admin_notes(author_id);
create index platform_admin_audit_organization_created_idx on private.platform_admin_audit_logs(organization_id, created_at desc);
create index platform_admin_audit_actor_idx on private.platform_admin_audit_logs(actor_id);
create index organization_invitations_accepted_by_idx on public.organization_invitations(accepted_by) where accepted_by is not null;

create or replace function private.is_platform_administrator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from private.platform_administrators administrator
    where administrator.profile_id = (select auth.uid())
      and administrator.enabled
  );
$$;

create or replace function private.organization_access_allowed(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_entitlements entitlement
    where entitlement.organization_id = target_organization_id
      and (
        entitlement.access_status = 'active'
        or (entitlement.access_status = 'trialing' and entitlement.trial_ends_at > now())
        or (entitlement.access_status = 'grace_period' and (entitlement.current_period_end is null or entitlement.current_period_end > now()))
      )
  );
$$;

revoke all on function private.is_platform_administrator() from public, anon, authenticated;
revoke all on function private.organization_access_allowed(uuid) from public, anon, authenticated;

create or replace function private.is_organization_member(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and private.organization_access_allowed(target_organization_id)
    and exists (
      select 1 from public.organization_members member
      where member.organization_id = target_organization_id
        and member.profile_id = (select auth.uid())
    );
$$;

create or replace function private.has_organization_role(target_organization_id uuid, allowed_roles public.organization_role[])
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and private.organization_access_allowed(target_organization_id)
    and exists (
      select 1 from public.organization_members member
      where member.organization_id = target_organization_id
        and member.profile_id = (select auth.uid())
        and member.role = any(allowed_roles)
    );
$$;

create or replace function private.shares_organization(target_profile_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id=mine.organization_id
    where mine.profile_id=(select auth.uid())
      and theirs.profile_id=target_profile_id
      and private.organization_access_allowed(mine.organization_id)
  );
$$;

revoke all on function private.shares_organization(uuid) from public, anon, authenticated;

create or replace function private.create_organization_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_entitlements (organization_id,plan,access_status,trial_ends_at,staff_limit)
  values (new.id,'trial','trialing',now()+interval '30 days',5)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

revoke all on function private.create_organization_entitlement() from public, anon, authenticated;
create trigger organizations_create_entitlement
  after insert on public.organizations
  for each row execute function private.create_organization_entitlement();

insert into public.organization_entitlements (organization_id,plan,access_status,trial_ends_at,staff_limit)
select organization.id,'complimentary','active',null,25
from public.organizations organization
on conflict (organization_id) do nothing;

create trigger organization_entitlements_updated_at
  before update on public.organization_entitlements
  for each row execute function private.set_updated_at();

create policy organization_entitlements_member_select
on public.organization_entitlements for select to authenticated
using (
  (select private.is_platform_administrator())
  or exists (
    select 1 from public.organization_members member
    where member.organization_id = organization_entitlements.organization_id
      and member.profile_id = (select auth.uid())
  )
);

grant select on table public.organization_entitlements to authenticated;

create or replace function private.enforce_organization_access_on_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid := coalesce(new.organization_id,old.organization_id);
begin
  if (select auth.uid()) is not null and not private.organization_access_allowed(target_organization_id) then
    raise exception 'Organization access is not active. Contact Greenhouse Ledger support.';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.enforce_organization_access_on_write() from public, anon, authenticated;

create trigger activity_logs_enforce_entitlement before insert or update or delete on public.activity_logs for each row execute function private.enforce_organization_access_on_write();
create trigger backup_recovery_runs_enforce_entitlement before insert or update or delete on public.backup_recovery_runs for each row execute function private.enforce_organization_access_on_write();
create trigger care_tasks_enforce_entitlement before insert or update or delete on public.care_tasks for each row execute function private.enforce_organization_access_on_write();
create trigger inventory_batches_enforce_entitlement before insert or update or delete on public.inventory_batches for each row execute function private.enforce_organization_access_on_write();
create trigger inventory_count_lines_enforce_entitlement before insert or update or delete on public.inventory_count_lines for each row execute function private.enforce_organization_access_on_write();
create trigger inventory_counts_enforce_entitlement before insert or update or delete on public.inventory_counts for each row execute function private.enforce_organization_access_on_write();
create trigger inventory_transactions_enforce_entitlement before insert or update or delete on public.inventory_transactions for each row execute function private.enforce_organization_access_on_write();
create trigger locations_enforce_entitlement before insert or update or delete on public.locations for each row execute function private.enforce_organization_access_on_write();
create trigger organization_invitations_enforce_entitlement before insert or update or delete on public.organization_invitations for each row execute function private.enforce_organization_access_on_write();
create trigger organization_members_enforce_entitlement before insert or update or delete on public.organization_members for each row execute function private.enforce_organization_access_on_write();
create trigger plant_catalog_enforce_entitlement before insert or update or delete on public.plant_catalog for each row execute function private.enforce_organization_access_on_write();
create trigger plant_health_issue_updates_enforce_entitlement before insert or update or delete on public.plant_health_issue_updates for each row execute function private.enforce_organization_access_on_write();
create trigger plant_health_issues_enforce_entitlement before insert or update or delete on public.plant_health_issues for each row execute function private.enforce_organization_access_on_write();

create or replace function private.enforce_organization_staff_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare allowed_staff integer; current_staff integer;
begin
  select staff_limit into allowed_staff from public.organization_entitlements where organization_id=new.organization_id;
  select count(*) into current_staff from public.organization_members where organization_id=new.organization_id;
  if current_staff>=allowed_staff then raise exception 'This organization has reached its staff limit'; end if;
  return new;
end;
$$;

create or replace function private.enforce_organization_invitation_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare allowed_staff integer; reserved_seats integer;
begin
  select staff_limit into allowed_staff from public.organization_entitlements where organization_id=new.organization_id;
  select
    (select count(*) from public.organization_members where organization_id=new.organization_id)
    +(select count(*) from public.organization_invitations where organization_id=new.organization_id and accepted_at is null and revoked_at is null and expires_at>now())
  into reserved_seats;
  if reserved_seats>=allowed_staff then raise exception 'This organization has reached its staff limit'; end if;
  return new;
end;
$$;

revoke all on function private.enforce_organization_staff_limit() from public, anon, authenticated;
revoke all on function private.enforce_organization_invitation_limit() from public, anon, authenticated;
create trigger organization_members_enforce_staff_limit before insert on public.organization_members for each row execute function private.enforce_organization_staff_limit();
create trigger organization_invitations_enforce_staff_limit before insert on public.organization_invitations for each row execute function private.enforce_organization_invitation_limit();

create or replace function public.is_platform_administrator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.is_platform_administrator(); $$;

create or replace function public.get_organization_invitation_details(invitation_code uuid)
returns table(organization_name text,email text,role public.organization_role,expires_at timestamptz)
language sql stable security definer set search_path=''
as $$
  select organization.name,invitation.email,invitation.role,invitation.expires_at
  from public.organization_invitations invitation
  join public.organizations organization on organization.id=invitation.organization_id
  where invitation.code=invitation_code
    and invitation.accepted_at is null
    and invitation.revoked_at is null
    and invitation.expires_at>now()
    and private.organization_access_allowed(invitation.organization_id)
  limit 1;
$$;

create or replace function public.list_account_organizations()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'role',member.role,
    'organization',to_jsonb(organization),
    'entitlement',jsonb_build_object(
      'plan',entitlement.plan,
      'access_status',entitlement.access_status,
      'trial_ends_at',entitlement.trial_ends_at,
      'current_period_end',entitlement.current_period_end,
      'staff_limit',entitlement.staff_limit
    )
  ) order by organization.name),'[]'::jsonb)
  from public.organization_members member
  join public.organizations organization on organization.id=member.organization_id
  join public.organization_entitlements entitlement on entitlement.organization_id=organization.id
  where member.profile_id=(select auth.uid());
$$;

create or replace function public.get_platform_admin_overview(search_term text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not private.is_platform_administrator() then raise exception 'Platform administrator access required'; end if;
  if char_length(coalesce(search_term,''))>100 then raise exception 'Search must be 100 characters or fewer'; end if;

  with organization_rows as (
    select organization.id,organization.name,organization.created_at,
      entitlement.plan,entitlement.access_status,entitlement.trial_ends_at,entitlement.current_period_end,entitlement.staff_limit,
      count(distinct member.profile_id)::integer as member_count,
      count(distinct member.profile_id) filter (where member.role='owner')::integer as owner_count,
      count(distinct invitation.id) filter (where invitation.accepted_at is null and invitation.revoked_at is null and invitation.expires_at>now())::integer as pending_invitation_count,
      string_agg(distinct owner_profile.display_name,', ' order by owner_profile.display_name) filter (where member.role='owner') as owner_names
    from public.organizations organization
    join public.organization_entitlements entitlement on entitlement.organization_id=organization.id
    left join public.organization_members member on member.organization_id=organization.id
    left join public.profiles owner_profile on owner_profile.id=member.profile_id
    left join public.organization_invitations invitation on invitation.organization_id=organization.id
    where search_term is null or btrim(search_term)='' or organization.name ilike '%'||btrim(search_term)||'%'
    group by organization.id,entitlement.organization_id
    order by organization.created_at desc
    limit 200
  )
  select jsonb_build_object(
    'organizations',coalesce(jsonb_agg(to_jsonb(organization_rows) order by created_at desc),'[]'::jsonb),
    'metrics',jsonb_build_object(
      'organizations',(select count(*) from public.organization_entitlements),
      'active',(select count(*) from public.organization_entitlements where access_status in ('active','grace_period')),
      'trials',(select count(*) from public.organization_entitlements where access_status='trialing' and trial_ends_at>now()),
      'suspended',(select count(*) from public.organization_entitlements where access_status in ('suspended','canceled') or (access_status='trialing' and trial_ends_at<=now()))
    )
  ) into result from organization_rows;
  return result;
end;
$$;

create or replace function public.get_platform_admin_organization(target_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not private.is_platform_administrator() then raise exception 'Platform administrator access required'; end if;
  if not exists (select 1 from public.organizations where id=target_organization_id) then raise exception 'Organization not found'; end if;

  select jsonb_build_object(
    'organization',to_jsonb(organization),
    'entitlement',to_jsonb(entitlement),
    'members',coalesce((
      select jsonb_agg(jsonb_build_object('profile_id',member.profile_id,'display_name',profile.display_name,'username',profile.username,'email',account.email,'role',member.role,'joined_at',member.created_at) order by member.created_at)
      from public.organization_members member
      join public.profiles profile on profile.id=member.profile_id
      join auth.users account on account.id=member.profile_id
      where member.organization_id=organization.id
    ),'[]'::jsonb),
    'notes',coalesce((
      select jsonb_agg(jsonb_build_object('id',note.id,'note',note.note,'created_at',note.created_at,'author',author.display_name) order by note.created_at desc)
      from (select * from private.platform_admin_notes where organization_id=organization.id order by created_at desc limit 50) note
      left join public.profiles author on author.id=note.author_id
    ),'[]'::jsonb),
    'audit',coalesce((
      select jsonb_agg(jsonb_build_object('id',audit.id,'action',audit.action,'reason',audit.reason,'before_state',audit.before_state,'after_state',audit.after_state,'created_at',audit.created_at,'actor',actor.display_name) order by audit.created_at desc)
      from (select * from private.platform_admin_audit_logs where organization_id=organization.id order by created_at desc limit 50) audit
      left join public.profiles actor on actor.id=audit.actor_id
    ),'[]'::jsonb)
  ) into result
  from public.organizations organization
  join public.organization_entitlements entitlement on entitlement.organization_id=organization.id
  where organization.id=target_organization_id;
  return result;
end;
$$;

create or replace function public.update_organization_entitlement(
  target_organization_id uuid,
  target_plan text,
  target_access_status text,
  target_trial_ends_at timestamptz,
  target_current_period_end timestamptz,
  target_staff_limit integer,
  change_reason text
)
returns public.organization_entitlements
language plpgsql
security definer
set search_path = ''
as $$
declare before_record public.organization_entitlements; after_record public.organization_entitlements; actor uuid := (select auth.uid());
begin
  if not private.is_platform_administrator() then raise exception 'Platform administrator access required'; end if;
  if target_plan not in ('trial','pilot','starter','growth','custom','complimentary') then raise exception 'Choose a valid plan'; end if;
  if target_access_status not in ('trialing','active','grace_period','suspended','canceled') then raise exception 'Choose a valid access status'; end if;
  if target_access_status='trialing' and target_trial_ends_at is null then raise exception 'Trial end is required for trial access'; end if;
  if target_staff_limit not between 1 and 10000 then raise exception 'Staff limit must be between 1 and 10000'; end if;
  if char_length(btrim(coalesce(change_reason,''))) not between 3 and 500 then raise exception 'Record a reason between 3 and 500 characters'; end if;

  select * into before_record from public.organization_entitlements where organization_id=target_organization_id for update;
  if not found then raise exception 'Organization entitlement not found'; end if;

  update public.organization_entitlements set
    plan=target_plan,access_status=target_access_status,trial_ends_at=target_trial_ends_at,
    current_period_end=target_current_period_end,staff_limit=target_staff_limit
  where organization_id=target_organization_id returning * into after_record;

  insert into private.platform_admin_audit_logs (organization_id,actor_id,action,reason,before_state,after_state)
  values (target_organization_id,actor,'organization_entitlement_updated',btrim(change_reason),to_jsonb(before_record),to_jsonb(after_record));
  return after_record;
end;
$$;

create or replace function public.add_platform_admin_note(target_organization_id uuid, note_text text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare note_id bigint; actor uuid := (select auth.uid());
begin
  if not private.is_platform_administrator() then raise exception 'Platform administrator access required'; end if;
  if char_length(btrim(coalesce(note_text,''))) not between 2 and 2000 then raise exception 'Note must contain between 2 and 2000 characters'; end if;
  if not exists (select 1 from public.organizations where id=target_organization_id) then raise exception 'Organization not found'; end if;
  insert into private.platform_admin_notes (organization_id,author_id,note)
  values (target_organization_id,actor,btrim(note_text)) returning id into note_id;
  insert into private.platform_admin_audit_logs (organization_id,actor_id,action,reason)
  values (target_organization_id,actor,'platform_admin_note_added','Internal note added');
  return note_id;
end;
$$;

create or replace function public.create_organization_workspace(workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid()); new_organization_id uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.profiles where id=actor) then raise exception 'Complete account setup before creating an organization'; end if;
  if char_length(btrim(workspace_name)) not between 2 and 120 then raise exception 'Organization name must contain between 2 and 120 characters'; end if;
  if exists (select 1 from public.organization_members where profile_id=actor)
    and not private.is_platform_administrator()
    and not exists (
      select 1 from public.organization_members member
      where member.profile_id=actor and private.organization_access_allowed(member.organization_id)
    ) then
    raise exception 'Your existing organization access must be restored before creating another workspace';
  end if;
  insert into public.organizations (name,created_by) values (btrim(workspace_name),actor) returning id into new_organization_id;
  insert into public.organization_members (organization_id,profile_id,role) values (new_organization_id,actor,'owner');
  insert into public.activity_logs (organization_id,actor_id,entity_type,entity_id,action,details)
  values (new_organization_id,actor,'organization',new_organization_id,'organization_created',jsonb_build_object('phase',23));
  return new_organization_id;
end;
$$;

revoke all on function public.is_platform_administrator() from public, anon;
revoke all on function public.list_account_organizations() from public, anon;
revoke all on function public.get_platform_admin_overview(text) from public, anon;
revoke all on function public.get_platform_admin_organization(uuid) from public, anon;
revoke all on function public.update_organization_entitlement(uuid,text,text,timestamptz,timestamptz,integer,text) from public, anon;
revoke all on function public.add_platform_admin_note(uuid,text) from public, anon;
grant execute on function public.is_platform_administrator() to authenticated;
grant execute on function public.list_account_organizations() to authenticated;
grant execute on function public.get_platform_admin_overview(text) to authenticated;
grant execute on function public.get_platform_admin_organization(uuid) to authenticated;
grant execute on function public.update_organization_entitlement(uuid,text,text,timestamptz,timestamptz,integer,text) to authenticated;
grant execute on function public.add_platform_admin_note(uuid,text) to authenticated;

comment on table private.platform_administrators is 'Trusted allowlist for Greenhouse Ledger platform owners; configure only through database administration.';
comment on table public.organization_entitlements is 'Commercial plan and access state enforced for each greenhouse organization.';
comment on function public.get_platform_admin_overview(text) is 'Returns organization-level commercial metadata without customer inventory contents.';
