-- Greenhouse Ledger Phase 12: organization-wide visual identity
alter table public.organizations
  add column brand_primary text not null default '#8ba46c',
  add column brand_accent text not null default '#d68c5f',
  add column brand_background text not null default '#241d15',
  add column brand_logo_path text;

alter table public.organizations
  add constraint organizations_brand_primary_hex check (brand_primary ~ '^#[0-9a-fA-F]{6}$'),
  add constraint organizations_brand_accent_hex check (brand_accent ~ '^#[0-9a-fA-F]{6}$'),
  add constraint organizations_brand_background_hex check (brand_background ~ '^#[0-9a-fA-F]{6}$'),
  add constraint organizations_brand_logo_path_scope check (
    brand_logo_path is null or brand_logo_path like id::text || '/branding/%'
  );

comment on column public.organizations.brand_primary is 'Organization-wide primary interface color.';
comment on column public.organizations.brand_accent is 'Organization-wide accent interface color.';
comment on column public.organizations.brand_background is 'Organization-wide background interface color.';
comment on column public.organizations.brand_logo_path is 'Private greenhouse-photos object path for the organization logo.';
