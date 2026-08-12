-- Greenhouse Ledger Phase 14: guarded demonstration workspace seeding.
create or replace function public.seed_demo_organization(target_organization_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  propagation_house_id uuid := gen_random_uuid();
  retail_house_id uuid := gen_random_uuid();
  pothos_id uuid := gen_random_uuid();
  fern_id uuid := gen_random_uuid();
  lavender_id uuid := gen_random_uuid();
  pothos_batch_id uuid := gen_random_uuid();
  fern_batch_id uuid := gen_random_uuid();
  lavender_batch_id uuid := gen_random_uuid();
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = target_organization_id
      and member.profile_id = (select auth.uid())
      and member.role = 'owner'
  ) then
    raise exception 'Only the organization owner can load demo data';
  end if;

  perform 1 from public.organizations where id = target_organization_id for update;
  if exists (select 1 from public.locations where organization_id = target_organization_id)
    or exists (select 1 from public.plant_catalog where organization_id = target_organization_id)
    or exists (select 1 from public.inventory_batches where organization_id = target_organization_id)
    or exists (select 1 from public.care_tasks where organization_id = target_organization_id) then
    raise exception 'Demo data can only be loaded into an empty workspace';
  end if;

  insert into public.locations (id, organization_id, name, location_type, notes)
  values
    (propagation_house_id, target_organization_id, 'Propagation House', 'greenhouse', 'Warm, humid starting area for cuttings and seedlings.'),
    (retail_house_id, target_organization_id, 'Retail House', 'retail', 'Customer-ready stock and finishing benches.');

  insert into public.plant_catalog
    (id, organization_id, common_name, scientific_name, cultivar, sku, default_price, watering_days, feeding_days, care_notes)
  values
    (pothos_id, target_organization_id, 'Golden Pothos', 'Epipremnum aureum', null, 'POT-GOLD-4', 12.00, 7, 30, 'Allow the upper layer of substrate to dry between watering.'),
    (fern_id, target_organization_id, 'Boston Fern', 'Nephrolepis exaltata', 'Bostoniensis', 'FERN-BOS-6', 18.00, 3, 21, 'Maintain even moisture and inspect fronds for mites.'),
    (lavender_id, target_organization_id, 'English Lavender', 'Lavandula angustifolia', 'Hidcote', 'LAV-HID-4', 10.00, 6, 30, 'Provide high light and strong airflow.');

  insert into public.inventory_batches
    (id, organization_id, plant_catalog_id, location_id, batch_code, stage, quantity, unit_cost, unit_price, acquired_on, notes)
  values
    (pothos_batch_id, target_organization_id, pothos_id, propagation_house_id, 'DEMO-POT-001', 'vegetative', 36, 4.25, 12.00, current_date - 18, 'Sample demonstration batch.'),
    (fern_batch_id, target_organization_id, fern_id, retail_house_id, 'DEMO-FER-001', 'retail_ready', 18, 7.50, 18.00, current_date - 12, 'Sample demonstration batch.'),
    (lavender_batch_id, target_organization_id, lavender_id, propagation_house_id, 'DEMO-LAV-001', 'seedling', 48, 2.10, 10.00, current_date - 8, 'Sample demonstration batch.');

  insert into public.inventory_transactions
    (organization_id, batch_id, transaction_type, quantity, note, performed_by)
  values
    (target_organization_id, pothos_batch_id, 'received', 36, 'Phase 14 demonstration inventory', (select auth.uid())),
    (target_organization_id, fern_batch_id, 'received', 18, 'Phase 14 demonstration inventory', (select auth.uid())),
    (target_organization_id, lavender_batch_id, 'received', 48, 'Phase 14 demonstration inventory', (select auth.uid()));

  insert into public.care_tasks
    (organization_id, batch_id, location_id, task_type, title, notes, due_at, assigned_to, recurrence_days, created_by)
  values
    (target_organization_id, fern_batch_id, retail_house_id, 'watering', 'Water retail ferns', 'Check basket weight before watering.', now() + interval '2 hours', (select auth.uid()), 3, (select auth.uid())),
    (target_organization_id, lavender_batch_id, propagation_house_id, 'inspection', 'Inspect lavender seedlings', 'Record germination and remove weak seedlings.', now() + interval '1 day', (select auth.uid()), 7, (select auth.uid())),
    (target_organization_id, pothos_batch_id, propagation_house_id, 'feeding', 'Feed pothos batch', 'Use the standard vegetative feed rate.', now() + interval '3 days', (select auth.uid()), 30, (select auth.uid()));

  insert into public.activity_logs (organization_id, actor_id, entity_type, entity_id, action, details)
  values (target_organization_id, (select auth.uid()), 'organization', target_organization_id, 'demo_workspace_loaded', jsonb_build_object('phase', 14));
end;
$$;

revoke all on function public.seed_demo_organization(uuid) from public, anon;
grant execute on function public.seed_demo_organization(uuid) to authenticated;
