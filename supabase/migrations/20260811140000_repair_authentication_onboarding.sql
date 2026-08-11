-- Allow authenticated requests to evaluate the private RLS helper functions.
-- The helpers remain unavailable to anon and enforce auth.uid() internally.
grant usage on schema private to authenticated;
grant execute on function private.is_organization_member(uuid) to authenticated;
grant execute on function private.has_organization_role(uuid, public.organization_role[]) to authenticated;
grant execute on function private.is_organization_creator(uuid) to authenticated;
