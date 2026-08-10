alter table public.organizations
  add column if not exists currency_code text not null default 'USD',
  add column if not exists timezone text not null default 'America/New_York',
  add column if not exists low_stock_threshold integer not null default 5;

alter table public.organizations
  drop constraint if exists organizations_currency_code_check,
  add constraint organizations_currency_code_check
    check (currency_code ~ '^[A-Z]{3}$'),
  drop constraint if exists organizations_timezone_check,
  add constraint organizations_timezone_check
    check (char_length(timezone) between 1 and 80),
  drop constraint if exists organizations_low_stock_threshold_check,
  add constraint organizations_low_stock_threshold_check
    check (low_stock_threshold between 0 and 100000);

comment on column public.organizations.currency_code is
  'ISO 4217 currency code used to format workspace monetary values.';
comment on column public.organizations.timezone is
  'IANA timezone used for workspace-facing scheduling and dates.';
comment on column public.organizations.low_stock_threshold is
  'Batch quantity at or below which the workspace shows a low-stock alert.';
