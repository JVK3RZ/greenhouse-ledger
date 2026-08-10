-- Cover foreign keys used by tenant filtering, task assignment, and transfers.
create index activity_logs_actor_idx on public.activity_logs(actor_id);
create index care_tasks_assigned_to_idx on public.care_tasks(assigned_to);
create index care_tasks_batch_idx on public.care_tasks(batch_id);
create index care_tasks_completed_by_idx on public.care_tasks(completed_by);
create index care_tasks_created_by_idx on public.care_tasks(created_by);
create index care_tasks_location_idx on public.care_tasks(location_id);
create index inventory_batches_location_idx on public.inventory_batches(location_id);
create index inventory_batches_catalog_idx on public.inventory_batches(plant_catalog_id);
create index inventory_transactions_destination_batch_idx on public.inventory_transactions(destination_batch_id);
create index inventory_transactions_organization_idx on public.inventory_transactions(organization_id);
create index inventory_transactions_performed_by_idx on public.inventory_transactions(performed_by);
create index locations_parent_idx on public.locations(parent_id);
create index organizations_created_by_idx on public.organizations(created_by);
