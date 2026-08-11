-- Greenhouse Ledger repair: allow signed-in profile policies to evaluate shared organization membership
grant usage on schema private to authenticated;
revoke execute on function private.shares_organization(uuid) from public, anon;
grant execute on function private.shares_organization(uuid) to authenticated;
