-- Greenhouse Ledger Phase 15: sellable product details and lifecycle.
alter table public.plant_catalog
  add column container_size text check (container_size is null or char_length(trim(container_size)) between 1 and 80),
  add column status text not null default 'active' check (status in ('active','archived'));

create index plant_catalog_organization_status_idx
  on public.plant_catalog (organization_id, status, common_name);
