-- Make invitation acceptance operate entirely as the signed-in user under RLS.
alter table public.organization_invitations enable row level security;
create index organization_invitations_invited_by_idx on public.organization_invitations(invited_by);

drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select_colleague on public.profiles;
create policy profiles_select_self_or_colleague on public.profiles for select to authenticated
  using ((select auth.uid()) = id or private.shares_organization(id));

create policy invitations_recipient_select on public.organization_invitations for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email','')) and accepted_at is null and expires_at > now());
create policy invitations_recipient_update on public.organization_invitations for update to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email','')) and accepted_at is null and expires_at > now())
  with check (email = lower(coalesce(auth.jwt() ->> 'email','')));
create policy members_accept_invitation on public.organization_members for insert to authenticated
  with check (profile_id = (select auth.uid()) and exists (
    select 1 from public.organization_invitations invitation
    where invitation.organization_id = organization_members.organization_id
      and invitation.email = lower(coalesce(auth.jwt() ->> 'email',''))
      and invitation.role = organization_members.role
      and invitation.accepted_at is null and invitation.expires_at > now()
  ));

create or replace function public.accept_organization_invitation(invitation_code uuid)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare invitation public.organization_invitations%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select * into invitation from public.organization_invitations
    where code = invitation_code and accepted_at is null and expires_at > now() for update;
  if invitation.id is null then raise exception 'Invitation is invalid, expired, or belongs to another email'; end if;
  insert into public.organization_members(organization_id,profile_id,role)
    values(invitation.organization_id,(select auth.uid()),invitation.role)
    on conflict (organization_id,profile_id) do update set role=excluded.role;
  update public.organization_invitations set accepted_at=now() where id=invitation.id;
  insert into public.activity_logs(organization_id,actor_id,entity_type,entity_id,action,details)
    values(invitation.organization_id,(select auth.uid()),'staff',auth.uid(),'invitation_accepted',jsonb_build_object('role',invitation.role));
  return invitation.organization_id;
end;
$$;
