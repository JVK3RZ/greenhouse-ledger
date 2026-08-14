-- Greenhouse Ledger Phase 21: fresh-start demo accounts.
-- Demo designation is administrative. Authenticated clients can only learn whether
-- their own account is a demo; they cannot designate accounts or delete workspaces.
create table public.demo_accounts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.demo_accounts enable row level security;
revoke all on table public.demo_accounts from public, anon, authenticated;

create or replace function public.is_demo_account()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.demo_accounts demo
    where demo.profile_id = (select auth.uid())
      and demo.enabled
  );
$$;

revoke all on function public.is_demo_account() from public, anon;
grant execute on function public.is_demo_account() to authenticated;

comment on table public.demo_accounts is
  'Administrative allowlist for reusable Phase 21 demo identities. Add a profile only through a trusted database administration workflow.';
comment on function public.is_demo_account() is
  'Returns demo status only for the currently authenticated account.';
