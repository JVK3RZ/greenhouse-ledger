-- Cover the webhook-event organization foreign key for deletes and organization-scoped audits.
create index stripe_webhook_events_organization_id_idx
  on private.stripe_webhook_events(organization_id)
  where organization_id is not null;
