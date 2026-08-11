-- Greenhouse Ledger Phase 11: unique usernames for business accounts
alter table public.profiles add column username text;

create unique index profiles_username_unique_idx on public.profiles (lower(username)) where username is not null;

alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$');

create or replace function private.normalize_profile_username()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.username = nullif(lower(trim(new.username)), '');
  return new;
end;
$$;
revoke all on function private.normalize_profile_username() from public, anon, authenticated;

create trigger profiles_normalize_username before insert or update of username on public.profiles
  for each row execute function private.normalize_profile_username();

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, username)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(lower(trim(new.raw_user_meta_data ->> 'username')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;

comment on column public.profiles.username is 'Unique, normalized sign-in name chosen by the account owner.';
