-- Greenhouse Ledger Phase 22: atomic organization creation for multi-workspace accounts.
create or replace function public.create_organization_workspace(workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  new_organization_id uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.profiles where id=actor) then
    raise exception 'Complete account setup before creating an organization';
  end if;
  if char_length(btrim(workspace_name)) not between 2 and 120 then
    raise exception 'Organization name must contain between 2 and 120 characters';
  end if;

  insert into public.organizations (name,created_by)
  values (btrim(workspace_name),actor)
  returning id into new_organization_id;

  insert into public.organization_members (organization_id,profile_id,role)
  values (new_organization_id,actor,'owner');

  insert into public.activity_logs (organization_id,actor_id,entity_type,entity_id,action,details)
  values (new_organization_id,actor,'organization',new_organization_id,'organization_created',jsonb_build_object('phase',22));

  return new_organization_id;
end;
$$;

revoke insert on table public.organizations from authenticated;
revoke all on function public.create_organization_workspace(text) from public,anon;
grant execute on function public.create_organization_workspace(text) to authenticated;

comment on function public.create_organization_workspace(text) is
  'Atomically creates an isolated organization and owner membership for the authenticated profile.';
