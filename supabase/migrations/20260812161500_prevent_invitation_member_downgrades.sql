-- Never allow an invitation to rewrite an existing organization membership role.
create or replace function private.prevent_duplicate_member_invitation()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if exists (
    select 1
    from auth.users account
    join public.organization_members member on member.profile_id=account.id
    where member.organization_id=new.organization_id
      and lower(account.email)=new.email
  ) then
    raise exception 'That person is already a member of this organization';
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_duplicate_member_invitation() from public,anon,authenticated;

drop trigger if exists invitation_reject_existing_member on public.organization_invitations;
create trigger invitation_reject_existing_member
before insert on public.organization_invitations
for each row execute function private.prevent_duplicate_member_invitation();

create or replace function public.accept_organization_invitation(invitation_code uuid)
returns uuid language plpgsql security definer set search_path=''
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
