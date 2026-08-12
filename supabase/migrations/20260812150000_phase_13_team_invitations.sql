-- Greenhouse Ledger Phase 13: invitation lifecycle, safe previews, and email delivery tracking.
alter table public.organization_invitations
  add column revoked_at timestamptz,
  add column accepted_by uuid references public.profiles(id),
  add column sent_at timestamptz,
  add column delivery_status text not null default 'not_sent'
    check (delivery_status in ('not_sent','sent','failed')),
  add column delivery_error text;

alter table public.organization_invitations
  add constraint organization_invitations_terminal_state_check check (
    not (accepted_at is not null and revoked_at is not null)
  );

create index organization_invitations_status_idx
  on public.organization_invitations(organization_id, accepted_at, revoked_at, expires_at desc);

-- Invitation state changes use narrow RPCs; clients cannot arbitrarily rewrite invitation rows.
drop policy if exists invitations_update on public.organization_invitations;

create or replace function public.revoke_organization_invitation(target_invitation_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare target_organization_id uuid;
begin
  select organization_id into target_organization_id from public.organization_invitations
    where id=target_invitation_id and accepted_at is null and revoked_at is null;
  if target_organization_id is null then raise exception 'Active invitation not found'; end if;
  if not private.has_organization_role(target_organization_id,array['owner','manager']::public.organization_role[])
    then raise exception 'Owner or manager access required'; end if;
  update public.organization_invitations set revoked_at=now() where id=target_invitation_id;
end;
$$;
revoke all on function public.revoke_organization_invitation(uuid) from public, anon;
grant execute on function public.revoke_organization_invitation(uuid) to authenticated;

create or replace function public.get_organization_invitation_details(invitation_code uuid)
returns table(organization_name text,email text,role public.organization_role,expires_at timestamptz)
language sql stable security definer set search_path=''
as $$
  select organization.name, invitation.email, invitation.role, invitation.expires_at
  from public.organization_invitations invitation
  join public.organizations organization on organization.id=invitation.organization_id
  where invitation.code=invitation_code
    and invitation.accepted_at is null
    and invitation.revoked_at is null
    and invitation.expires_at>now()
  limit 1;
$$;
revoke all on function public.get_organization_invitation_details(uuid) from public;
grant execute on function public.get_organization_invitation_details(uuid) to anon, authenticated;

create or replace function public.accept_organization_invitation(invitation_code uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare invitation public.organization_invitations%rowtype;
declare user_email text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select lower(email) into user_email from auth.users where id=(select auth.uid());
  select * into invitation from public.organization_invitations
    where code=invitation_code and accepted_at is null and revoked_at is null and expires_at>now() for update;
  if invitation.id is null then raise exception 'Invitation is invalid, expired, or revoked'; end if;
  if invitation.email<>user_email then raise exception 'Sign in with the email address named on this invitation'; end if;
  insert into public.organization_members(organization_id,profile_id,role)
    values(invitation.organization_id,(select auth.uid()),invitation.role)
    on conflict (organization_id,profile_id) do update set role=excluded.role;
  update public.organization_invitations
    set accepted_at=now(),accepted_by=(select auth.uid()) where id=invitation.id;
  insert into public.activity_logs(organization_id,actor_id,entity_type,entity_id,action,details)
    values(invitation.organization_id,(select auth.uid()),'staff',auth.uid(),'invitation_accepted',jsonb_build_object('role',invitation.role));
  return invitation.organization_id;
end;
$$;
revoke all on function public.accept_organization_invitation(uuid) from public, anon;
grant execute on function public.accept_organization_invitation(uuid) to authenticated;
