-- Make the physical-count tables explicitly read-only through the Data API.
revoke all on table public.inventory_counts, public.inventory_count_lines from public, anon, authenticated;
grant select on table public.inventory_counts, public.inventory_count_lines to authenticated;

-- Cover Phase 16 foreign keys used by history and staff lookups.
create index inventory_counts_location_idx on public.inventory_counts (location_id);
create index inventory_counts_started_by_idx on public.inventory_counts (started_by);
create index inventory_counts_completed_by_idx on public.inventory_counts (completed_by);
create index inventory_count_lines_organization_idx on public.inventory_count_lines (organization_id);
create index inventory_count_lines_counted_by_idx on public.inventory_count_lines (counted_by);
