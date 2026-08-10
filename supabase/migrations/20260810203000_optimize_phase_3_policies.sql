-- Consolidate permissive policies and cache auth calls per statement.
drop policy if exists invitations_manage on public.organization_invitations;
drop policy if exists invitations_recipient_select on public.organization_invitations;
drop policy if exists invitations_recipient_update on public.organization_invitations;
create policy invitations_select on public.organization_invitations for select to authenticated using (
  private.has_organization_role(organization_id,array['owner','manager']::public.organization_role[])
  or (email=lower(coalesce((select auth.jwt()) ->> 'email','')) and accepted_at is null and expires_at>now())
);
create policy invitations_insert on public.organization_invitations for insert to authenticated with check (
  private.has_organization_role(organization_id,array['owner','manager']::public.organization_role[]) and invited_by=(select auth.uid())
);
create policy invitations_update on public.organization_invitations for update to authenticated
  using (private.has_organization_role(organization_id,array['owner','manager']::public.organization_role[])
    or (email=lower(coalesce((select auth.jwt()) ->> 'email','')) and accepted_at is null and expires_at>now()))
  with check (private.has_organization_role(organization_id,array['owner','manager']::public.organization_role[])
    or email=lower(coalesce((select auth.jwt()) ->> 'email','')));
create policy invitations_delete on public.organization_invitations for delete to authenticated using (
  private.has_organization_role(organization_id,array['owner','manager']::public.organization_role[])
);

drop policy if exists members_bootstrap_or_manage on public.organization_members;
drop policy if exists members_accept_invitation on public.organization_members;
create policy members_insert on public.organization_members for insert to authenticated with check (
  (profile_id=(select auth.uid()) and role='owner' and private.is_organization_creator(organization_id))
  or private.has_organization_role(organization_id,array['owner','manager']::public.organization_role[])
  or (profile_id=(select auth.uid()) and exists (
    select 1 from public.organization_invitations invitation
    where invitation.organization_id=organization_members.organization_id
      and invitation.email=lower(coalesce((select auth.jwt()) ->> 'email',''))
      and invitation.role=organization_members.role
      and invitation.accepted_at is null and invitation.expires_at>now()
  ))
);
