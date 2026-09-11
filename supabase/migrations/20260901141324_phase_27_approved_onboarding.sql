-- Phase 27: only an approved, email-bound invitation can create a customer workspace.
create table private.owner_account_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email=lower(btrim(email)) and char_length(email)<=254),
  display_name text not null check (char_length(display_name) between 2 and 80),
  business_name text not null check (char_length(business_name) between 2 and 120),
  status text not null default 'pending' check (status in ('pending','approved','rejected','revoked','accepted')),
  code uuid unique,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  sent_at timestamptz,
  delivery_status text not null default 'not_sent' check (delivery_status in ('not_sent','sending','sent','failed')),
  delivery_attempt_at timestamptz,
  accepted_by uuid references public.profiles(id),
  organization_id uuid references public.organizations(id)
);
alter table private.owner_account_requests enable row level security;
revoke all on private.owner_account_requests from public,anon,authenticated;
create index owner_requests_created_idx on private.owner_account_requests(created_at desc);
create index owner_requests_email_idx on private.owner_account_requests(email,created_at desc);
create index owner_requests_reviewer_idx on private.owner_account_requests(reviewed_by);
create index owner_requests_accepted_idx on private.owner_account_requests(accepted_by);
create index owner_requests_org_idx on private.owner_account_requests(organization_id);
alter table public.organization_invitations add column activation_attempt_at timestamptz;

create function public.request_owner_account(request_email text,request_name text,business_name text)
returns void language plpgsql security definer set search_path='' as $$
declare normalized_email text := lower(btrim(coalesce(request_email,'')));
begin
  if char_length(normalized_email)>254 or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or char_length(btrim(coalesce(request_name,''))) not between 2 and 80
    or char_length(btrim(coalesce(business_name,''))) not between 2 and 120 then
    raise exception 'Enter a valid email, name, and business name';
  end if;
  -- Serialize the small public queue; return the same response for duplicate requests.
  perform pg_advisory_xact_lock(27001);
  if exists(select 1 from private.owner_account_requests r where r.email=normalized_email and
      (r.status in ('pending','approved') or r.created_at>now()-interval '1 day')) then return; end if;
  if (select count(*) from private.owner_account_requests where created_at>now()-interval '1 day')>=200 then
    raise exception 'Requests are temporarily unavailable. Please try again later';
  end if;
  insert into private.owner_account_requests(email,display_name,business_name)
    values(normalized_email,btrim(request_name),btrim(business_name));
end; $$;

create function public.list_owner_account_requests()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.is_platform_administrator() then raise exception 'Platform administrator access required'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r)-'code') from
    (select * from private.owner_account_requests order by (status in ('pending','approved')) desc,created_at desc limit 200) r),'[]'::jsonb);
end; $$;

create function public.review_owner_account_request(request_id uuid,decision text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.is_platform_administrator() then raise exception 'Platform administrator access required'; end if;
  if decision not in ('rejected','revoked') or decision is null then raise exception 'Invalid decision'; end if;
  update private.owner_account_requests set status=decision,code=null,expires_at=null,reviewed_at=now(),reviewed_by=auth.uid()
    where id=request_id and status in ('pending','approved');
  if not found then raise exception 'Active request not found'; end if;
end; $$;

-- Called with the administrator/manager JWT before server-side Auth link generation.
create function public.prepare_account_activation(activation_kind text,target_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.owner_account_requests%rowtype; i public.organization_invitations%rowtype; target_email text; target_code uuid; business text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if public.is_demo_account() then raise exception 'Invitation email is disabled in demo mode'; end if;
  if activation_kind='owner' then
    if not private.is_platform_administrator() then raise exception 'Platform administrator access required'; end if;
    select * into r from private.owner_account_requests where id=target_id for update;
    if r.id is null or r.status not in ('pending','approved') then raise exception 'Active request not found'; end if;
    if r.delivery_attempt_at>now()-interval '60 seconds' then raise exception 'Please wait a minute before resending'; end if;
    target_code:=gen_random_uuid(); target_email:=r.email; business:=r.business_name;
    update private.owner_account_requests set status='approved',code=target_code,expires_at=now()+interval '7 days',
      reviewed_at=now(),reviewed_by=auth.uid(),delivery_status='sending',delivery_attempt_at=now(),sent_at=null where id=target_id;
  elsif activation_kind='staff' then
    select * into i from public.organization_invitations where id=target_id for update;
    if i.id is null then raise exception 'Invitation not found'; end if;
    if not private.has_organization_role(i.organization_id,array['owner','manager']::public.organization_role[])
      or (i.role<>'worker' and not private.has_organization_role(i.organization_id,array['owner']::public.organization_role[])) then
      raise exception 'Owner or manager access required';
    end if;
    if i.accepted_at is not null or i.revoked_at is not null or i.expires_at<=now() then raise exception 'Only active invitations can be emailed'; end if;
    if i.activation_attempt_at>now()-interval '60 seconds' then raise exception 'Please wait a minute before resending'; end if;
    update public.organization_invitations set activation_attempt_at=now() where id=target_id;
    target_email:=i.email; target_code:=i.code;
    select name into business from public.organizations where id=i.organization_id;
  else raise exception 'Invalid activation kind'; end if;
  return jsonb_build_object('email',target_email,'code',target_code,'business',business,
    'existing_user',exists(select 1 from auth.users where lower(email)=target_email));
end; $$;

-- Delivery receipts cannot be fabricated by clients, and old sends cannot resurrect revoked requests.
create function public.record_activation_delivery(activation_kind text,target_id uuid,activation_code uuid,delivered boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if activation_kind='owner' then
    update private.owner_account_requests set delivery_status=case when delivered then 'sent' else 'failed' end,
      sent_at=case when delivered then now() else null end
      where id=target_id and code=activation_code and status='approved';
  elsif activation_kind='staff' then
    update public.organization_invitations set delivery_status=case when delivered then 'sent' else 'failed' end,
      delivery_error=case when delivered then null else 'Activation email delivery failed. Try resending.' end,
      sent_at=case when delivered then now() else null end
      where id=target_id and code=activation_code and revoked_at is null and accepted_at is null;
  end if;
end; $$;

create function public.get_owner_activation(invitation_code uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.owner_account_requests%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select * into r from private.owner_account_requests where code=invitation_code and status='approved' and expires_at>now();
  if r.id is null or not exists(select 1 from auth.users where id=auth.uid() and lower(email)=r.email and email_confirmed_at is not null) then
    raise exception 'Invitation is invalid, expired, revoked, or belongs to another email';
  end if;
  return jsonb_build_object('business_name',r.business_name,'email',r.email);
end; $$;

create function public.accept_owner_activation(invitation_code uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare r private.owner_account_requests%rowtype; org uuid; actor uuid:=auth.uid();
begin
  perform public.get_owner_activation(invitation_code);
  select * into r from private.owner_account_requests where code=invitation_code and status='approved' and expires_at>now() for update;
  if r.id is null then raise exception 'Invitation has already been used or revoked'; end if;
  if not exists(select 1 from public.profiles where id=actor and username is not null) then raise exception 'Complete account setup first'; end if;
  insert into public.organizations(name,created_by) values(r.business_name,actor) returning id into org;
  insert into public.organization_members(organization_id,profile_id,role) values(org,actor,'owner');
  update private.owner_account_requests set status='accepted',accepted_by=actor,organization_id=org where id=r.id;
  insert into public.activity_logs(organization_id,actor_id,entity_type,entity_id,action,details)
    values(org,actor,'organization',org,'organization_created',jsonb_build_object('phase',27,'owner_request_id',r.id));
  return org;
end; $$;

create or replace function public.create_organization_workspace(workspace_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); org uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if not private.is_platform_administrator() and not public.is_demo_account() then raise exception 'Request owner approval before creating a workspace'; end if;
  if char_length(btrim(coalesce(workspace_name,''))) not between 2 and 120 then raise exception 'Organization name must contain between 2 and 120 characters'; end if;
  insert into public.organizations(name,created_by) values(btrim(workspace_name),actor) returning id into org;
  insert into public.organization_members(organization_id,profile_id,role) values(org,actor,'owner');
  insert into public.activity_logs(organization_id,actor_id,entity_type,entity_id,action,details)
    values(org,actor,'organization',org,'organization_created',jsonb_build_object('phase',27));
  return org;
end; $$;

create or replace function public.accept_organization_invitation(invitation_code uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare invitation public.organization_invitations%rowtype;
declare user_email text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select lower(email) into user_email from auth.users where id=(select auth.uid()) and email_confirmed_at is not null;
  if user_email is null then raise exception 'Open the activation email before accepting'; end if;
  select * into invitation from public.organization_invitations
    where code=invitation_code and accepted_at is null and revoked_at is null and expires_at>now() for update;
  if invitation.id is null then raise exception 'Invitation is invalid, expired, or revoked'; end if;
  if not private.organization_access_allowed(invitation.organization_id) then raise exception 'Organization access is inactive'; end if;
  if invitation.email<>user_email then raise exception 'Sign in with the email address named on this invitation'; end if;
  if exists (
    select 1 from public.organization_members
    where organization_id=invitation.organization_id and profile_id=(select auth.uid())
  ) then
    raise exception 'This account already belongs to this organization; its existing role was not changed';
  end if;
  insert into public.organization_members(organization_id,profile_id,role)
    values(invitation.organization_id,(select auth.uid()),invitation.role);
  update public.organization_invitations
    set accepted_at=now(),accepted_by=(select auth.uid()) where id=invitation.id;
  insert into public.activity_logs(organization_id,actor_id,entity_type,entity_id,action,details)
    values(invitation.organization_id,(select auth.uid()),'staff',auth.uid(),'invitation_accepted',jsonb_build_object('role',invitation.role));
  return invitation.organization_id;
end;
$$;
revoke all on function public.accept_organization_invitation(uuid) from public,anon;
grant execute on function public.accept_organization_invitation(uuid) to authenticated;

revoke all on function public.request_owner_account(text,text,text) from public,anon,authenticated;
grant execute on function public.request_owner_account(text,text,text) to anon,authenticated;
revoke all on function public.list_owner_account_requests() from public,anon,authenticated;
grant execute on function public.list_owner_account_requests() to authenticated;
revoke all on function public.review_owner_account_request(uuid,text) from public,anon,authenticated;
grant execute on function public.review_owner_account_request(uuid,text) to authenticated;
revoke all on function public.prepare_account_activation(text,uuid) from public,anon,authenticated;
grant execute on function public.prepare_account_activation(text,uuid) to authenticated;
revoke all on function public.record_activation_delivery(text,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.record_activation_delivery(text,uuid,uuid,boolean) to service_role;
revoke all on function public.get_owner_activation(uuid) from public,anon,authenticated;
grant execute on function public.get_owner_activation(uuid) to authenticated;
revoke all on function public.accept_owner_activation(uuid) from public,anon,authenticated;
grant execute on function public.accept_owner_activation(uuid) to authenticated;
revoke all on function public.create_organization_workspace(text) from public,anon,authenticated;
grant execute on function public.create_organization_workspace(text) to authenticated;
