-- Restore the authenticated helper permission required by profile RLS during sign-in.
-- Phase 23 recreated the helper and revoked this grant unintentionally.
revoke execute on function private.shares_organization(uuid) from public, anon;
grant execute on function private.shares_organization(uuid) to authenticated;
