-- Greenhouse Ledger Phase 24: organization-scoped employee lifecycle management.
create type public.organization_member_status as enum ('active','suspended');

alter table public.organization_members
  add column status public.organization_member_status not null default 'active',
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid references public.profiles(id) on delete set null,
  add column suspended_at timestamptz;

create index organization_members_organization_status_role_idx
  on public.organization_members (organization_id,status,role);

create trigger organization_members_updated_at
  before update on public.organization_members
  for each row execute function private.set_updated_at();

create or replace function private.is_organization_member(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and private.organization_access_allowed(target_organization_id)
    and exists (
      select 1 from public.organization_members member
      where member.organization_id=target_organization_id
        and member.profile_id=(select auth.uid())
        and member.status='active'
    );
$$;

create or replace function private.has_organization_role(target_organization_id uuid,allowed_roles public.organization_role[])
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and private.organization_access_allowed(target_organization_id)
    and exists (
      select 1 from public.organization_members member
      where member.organization_id=target_organization_id
        and member.profile_id=(select auth.uid())
        and member.status='active'
        and member.role=any(allowed_roles)
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
      and mine.status='active'
      and theirs.profile_id=target_profile_id
      and private.organization_access_allowed(mine.organization_id)
  );
$$;

revoke execute on function private.is_organization_member(uuid) from public,anon;
revoke execute on function private.has_organization_role(uuid,public.organization_role[]) from public,anon;
revoke execute on function private.shares_organization(uuid) from public,anon;
grant execute on function private.is_organization_member(uuid) to authenticated;
grant execute on function private.has_organization_role(uuid,public.organization_role[]) to authenticated;
grant execute on function private.shares_organization(uuid) to authenticated;

drop trigger if exists organization_members_enforce_staff_limit on public.organization_members;
drop trigger if exists organization_invitations_enforce_staff_limit on public.organization_invitations;

create or replace function private.enforce_organization_staff_limit()
returns trigger language plpgsql security definer set search_path=''
as $$
declare allowed_staff integer; occupied_seats integer; account_email text;
begin
  if new.status<>'active' then return new; end if;
  if tg_op='UPDATE' and old.status='active' then return new; end if;

  select entitlement.staff_limit into allowed_staff
  from public.organization_entitlements entitlement
  where entitlement.organization_id=new.organization_id
  for update;

  select lower(account.email) into account_email from auth.users account where account.id=new.profile_id;
  select
    (select count(*) from public.organization_members member
      where member.organization_id=new.organization_id and member.status='active')
    +(select count(*) from public.organization_invitations invitation
      where invitation.organization_id=new.organization_id
        and invitation.accepted_at is null and invitation.revoked_at is null and invitation.expires_at>now()
        and (account_email is null or invitation.email<>account_email))
  into occupied_seats;
  if occupied_seats>=allowed_staff then raise exception 'This organization has reached its staff limit'; end if;
  return new;
end;
$$;

create or replace function private.enforce_organization_invitation_limit()
returns trigger language plpgsql security definer set search_path=''
as $$
declare allowed_staff integer; occupied_seats integer;
begin
  select entitlement.staff_limit into allowed_staff
  from public.organization_entitlements entitlement
  where entitlement.organization_id=new.organization_id
  for update;
  select
    (select count(*) from public.organization_members member
      where member.organization_id=new.organization_id and member.status='active')
    +(select count(*) from public.organization_invitations invitation
      where invitation.organization_id=new.organization_id
        and invitation.accepted_at is null and invitation.revoked_at is null and invitation.expires_at>now())
  into occupied_seats;
  if occupied_seats>=allowed_staff then raise exception 'This organization has reached its staff limit'; end if;
  return new;
end;
$$;

revoke all on function private.enforce_organization_staff_limit() from public,anon,authenticated;
revoke all on function private.enforce_organization_invitation_limit() from public,anon,authenticated;
create trigger organization_members_enforce_staff_limit
  before insert or update of status on public.organization_members
  for each row execute function private.enforce_organization_staff_limit();
create trigger organization_invitations_enforce_staff_limit
  before insert on public.organization_invitations
  for each row execute function private.enforce_organization_invitation_limit();

create or replace function private.enforce_employee_invitation_authority()
returns trigger language plpgsql security definer set search_path=''
as $$
declare actor_role public.organization_role;
begin
  if (select auth.uid()) is null then return new; end if;
  select member.role into actor_role from public.organization_members member
    where member.organization_id=new.organization_id and member.profile_id=(select auth.uid()) and member.status='active';
  if actor_role is null or actor_role not in ('owner','manager') then raise exception 'Owner or manager access required'; end if;
  if actor_role='manager' and new.role<>'worker' then raise exception 'Managers can only invite workers'; end if;
  return new;
end;
$$;

revoke all on function private.enforce_employee_invitation_authority() from public,anon,authenticated;
create trigger organization_invitations_enforce_employee_authority
  before insert on public.organization_invitations
  for each row execute function private.enforce_employee_invitation_authority();

drop policy if exists members_insert on public.organization_members;
drop policy if exists members_bootstrap_or_manage on public.organization_members;
drop policy if exists members_update_manager on public.organization_members;
drop policy if exists members_delete_owner on public.organization_members;
revoke insert,update,delete on table public.organization_members from authenticated;

create or replace function public.list_account_organizations()
returns jsonb language sql stable security definer set search_path=''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'role',member.role,
    'status',member.status,
    'organization',to_jsonb(organization),
    'entitlement',jsonb_build_object(
      'plan',entitlement.plan,'access_status',entitlement.access_status,
      'trial_ends_at',entitlement.trial_ends_at,'current_period_end',entitlement.current_period_end,
      'staff_limit',entitlement.staff_limit
    )
  ) order by organization.name),'[]'::jsonb)
  from public.organization_members member
  join public.organizations organization on organization.id=member.organization_id
  join public.organization_entitlements entitlement on entitlement.organization_id=organization.id
  where member.profile_id=(select auth.uid());
$$;

create or replace function public.get_organization_team(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare actor uuid:=(select auth.uid()); actor_role public.organization_role; result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if not private.organization_access_allowed(target_organization_id) then raise exception 'Organization access is not active'; end if;
  select member.role into actor_role from public.organization_members member
    where member.organization_id=target_organization_id and member.profile_id=actor and member.status='active';
  if actor_role is null then raise exception 'Active organization membership required'; end if;

  select jsonb_build_object(
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'profile_id',member.profile_id,'display_name',profile.display_name,'username',profile.username,
      'email',case when actor_role in ('owner','manager') then account.email else null end,
      'role',member.role,'status',member.status,'joined_at',member.created_at,
      'updated_at',member.updated_at,'suspended_at',member.suspended_at
    ) order by member.status,member.role,profile.display_name)
      from public.organization_members member
      join public.profiles profile on profile.id=member.profile_id
      join auth.users account on account.id=member.profile_id
      where member.organization_id=target_organization_id),'[]'::jsonb),
    'seats',jsonb_build_object(
      'active_members',(select count(*) from public.organization_members member where member.organization_id=target_organization_id and member.status='active'),
      'suspended_members',(select count(*) from public.organization_members member where member.organization_id=target_organization_id and member.status='suspended'),
      'pending_invitations',(select count(*) from public.organization_invitations invitation where invitation.organization_id=target_organization_id and invitation.accepted_at is null and invitation.revoked_at is null and invitation.expires_at>now()),
      'staff_limit',(select entitlement.staff_limit from public.organization_entitlements entitlement where entitlement.organization_id=target_organization_id)
    )
  ) into result;
  return result;
end;
$$;

create or replace function public.update_organization_member(
  target_organization_id uuid,
  target_profile_id uuid,
  target_role public.organization_role,
  target_status public.organization_member_status,
  change_reason text default null
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=(select auth.uid()); actor_role public.organization_role; current_member public.organization_members%rowtype; updated_member public.organization_members%rowtype; active_owner_count integer;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if target_role is null or target_status is null then raise exception 'Role and status are required'; end if;
  if char_length(coalesce(change_reason,''))>500 then raise exception 'Reason must be 500 characters or fewer'; end if;
  if not private.organization_access_allowed(target_organization_id) then raise exception 'Organization access is not active'; end if;

  perform member.profile_id from public.organization_members member
    where member.organization_id=target_organization_id order by member.profile_id for update;
  select member.role into actor_role from public.organization_members member
    where member.organization_id=target_organization_id and member.profile_id=actor and member.status='active';
  if actor_role is null or actor_role not in ('owner','manager') then raise exception 'Owner or manager access required'; end if;
  select * into current_member from public.organization_members member
    where member.organization_id=target_organization_id and member.profile_id=target_profile_id;
  if current_member.profile_id is null then raise exception 'Organization member not found'; end if;

  if actor_role='manager' and (current_member.role<>'worker' or target_role<>'worker') then
    raise exception 'Managers can only activate or suspend workers';
  end if;
  if actor_role<>'owner' and (current_member.role='owner' or target_role='owner') then raise exception 'Only an owner can change ownership'; end if;

  if current_member.role='owner' and current_member.status='active' and not (target_role='owner' and target_status='active') then
    select count(*) into active_owner_count from public.organization_members member
      where member.organization_id=target_organization_id and member.role='owner' and member.status='active';
    if active_owner_count<=1 then raise exception 'Every organization must retain at least one active owner'; end if;
  end if;

  update public.organization_members set
    role=target_role,status=target_status,updated_by=actor,
    suspended_at=case when target_status='suspended' then coalesce(suspended_at,now()) else null end
  where organization_id=target_organization_id and profile_id=target_profile_id
  returning * into updated_member;

  insert into public.activity_logs(organization_id,actor_id,entity_type,entity_id,action,details)
  values(target_organization_id,actor,'staff',target_profile_id,'organization_member_updated',jsonb_build_object(
    'before',jsonb_build_object('role',current_member.role,'status',current_member.status),
    'after',jsonb_build_object('role',updated_member.role,'status',updated_member.status),
    'reason',nullif(btrim(change_reason),'')
  ));
  return jsonb_build_object('profile_id',updated_member.profile_id,'role',updated_member.role,'status',updated_member.status);
end;
$$;

create or replace function public.remove_organization_member(
  target_organization_id uuid,
  target_profile_id uuid,
  change_reason text default null
)
returns boolean language plpgsql security definer set search_path=''
as $$
declare actor uuid:=(select auth.uid()); actor_role public.organization_role; current_member public.organization_members%rowtype; active_owner_count integer;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if char_length(coalesce(change_reason,''))>500 then raise exception 'Reason must be 500 characters or fewer'; end if;
  if not private.organization_access_allowed(target_organization_id) then raise exception 'Organization access is not active'; end if;

  perform member.profile_id from public.organization_members member
    where member.organization_id=target_organization_id order by member.profile_id for update;
  select member.role into actor_role from public.organization_members member
    where member.organization_id=target_organization_id and member.profile_id=actor and member.status='active';
  if actor_role is null or actor_role not in ('owner','manager') then raise exception 'Owner or manager access required'; end if;
  select * into current_member from public.organization_members member
    where member.organization_id=target_organization_id and member.profile_id=target_profile_id;
  if current_member.profile_id is null then raise exception 'Organization member not found'; end if;
  if actor_role='manager' and current_member.role<>'worker' then raise exception 'Managers can only remove workers'; end if;
  if current_member.role='owner' and current_member.status='active' then
    select count(*) into active_owner_count from public.organization_members member
      where member.organization_id=target_organization_id and member.role='owner' and member.status='active';
    if active_owner_count<=1 then raise exception 'Every organization must retain at least one active owner'; end if;
  end if;

  delete from public.organization_members where organization_id=target_organization_id and profile_id=target_profile_id;
  insert into public.activity_logs(organization_id,actor_id,entity_type,entity_id,action,details)
  values(target_organization_id,actor,'staff',target_profile_id,'organization_member_removed',jsonb_build_object(
    'role',current_member.role,'status',current_member.status,'reason',nullif(btrim(change_reason),'')
  ));
  return true;
end;
$$;

create or replace function public.get_platform_admin_organization(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare result jsonb;
begin
  if not private.is_platform_administrator() then raise exception 'Platform administrator access required'; end if;
  if not exists (select 1 from public.organizations where id=target_organization_id) then raise exception 'Organization not found'; end if;
  select jsonb_build_object(
    'organization',to_jsonb(organization),'entitlement',to_jsonb(entitlement),
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'profile_id',member.profile_id,'display_name',profile.display_name,'username',profile.username,'email',account.email,
      'role',member.role,'status',member.status,'joined_at',member.created_at
    ) order by member.status,member.created_at)
      from public.organization_members member join public.profiles profile on profile.id=member.profile_id join auth.users account on account.id=member.profile_id
      where member.organization_id=organization.id),'[]'::jsonb),
    'notes',coalesce((select jsonb_agg(jsonb_build_object('id',note.id,'note',note.note,'created_at',note.created_at,'author',author.display_name) order by note.created_at desc)
      from (select * from private.platform_admin_notes where organization_id=organization.id order by created_at desc limit 50) note left join public.profiles author on author.id=note.author_id),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(jsonb_build_object('id',audit.id,'action',audit.action,'reason',audit.reason,'before_state',audit.before_state,'after_state',audit.after_state,'created_at',audit.created_at,'actor',actor.display_name) order by audit.created_at desc)
      from (select * from private.platform_admin_audit_logs where organization_id=organization.id order by created_at desc limit 50) audit left join public.profiles actor on actor.id=audit.actor_id),'[]'::jsonb)
  ) into result from public.organizations organization join public.organization_entitlements entitlement on entitlement.organization_id=organization.id where organization.id=target_organization_id;
  return result;
end;
$$;

revoke all on function public.get_organization_team(uuid) from public,anon;
revoke all on function public.update_organization_member(uuid,uuid,public.organization_role,public.organization_member_status,text) from public,anon;
revoke all on function public.remove_organization_member(uuid,uuid,text) from public,anon;
grant execute on function public.get_organization_team(uuid) to authenticated;
grant execute on function public.update_organization_member(uuid,uuid,public.organization_role,public.organization_member_status,text) to authenticated;
grant execute on function public.remove_organization_member(uuid,uuid,text) to authenticated;

comment on type public.organization_member_status is 'Organization-specific employee access lifecycle; suspension preserves history while blocking workspace access.';
comment on function public.update_organization_member(uuid,uuid,public.organization_role,public.organization_member_status,text) is 'Owner-managed role and status changes with manager-to-worker limits, last-owner protection, seat enforcement, and audit history.';
comment on function public.remove_organization_member(uuid,uuid,text) is 'Removes organization access without deleting the profile or historical operational records.';
