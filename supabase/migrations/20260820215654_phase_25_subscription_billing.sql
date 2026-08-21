-- Greenhouse Ledger Phase 25: Stripe subscription billing and webhook-owned entitlements.
create table private.organization_billing (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  subscription_status text,
  cancel_at_period_end boolean not null default false,
  current_period_end timestamptz,
  last_event_created timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  event_created timestamptz not null,
  organization_id uuid references public.organizations(id) on delete set null,
  processed_at timestamptz not null default now()
);

revoke all on table private.organization_billing, private.stripe_webhook_events from public,anon,authenticated;
create index stripe_webhook_events_processed_idx on private.stripe_webhook_events(processed_at desc);
create index organization_members_updated_by_idx on public.organization_members(updated_by) where updated_by is not null;

create or replace function public.get_organization_billing_summary(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare actor uuid:=(select auth.uid()); result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.organization_members member where member.organization_id=target_organization_id and member.profile_id=actor and member.role='owner' and member.status='active') then
    raise exception 'Active owner access required';
  end if;
  select jsonb_build_object(
    'plan',entitlement.plan,'access_status',entitlement.access_status,'trial_ends_at',entitlement.trial_ends_at,
    'current_period_end',entitlement.current_period_end,'staff_limit',entitlement.staff_limit,
    'subscription_status',billing.subscription_status,'cancel_at_period_end',coalesce(billing.cancel_at_period_end,false),
    'has_customer',billing.stripe_customer_id is not null,'has_subscription',billing.stripe_subscription_id is not null
  ) into result
  from public.organization_entitlements entitlement
  left join private.organization_billing billing on billing.organization_id=entitlement.organization_id
  where entitlement.organization_id=target_organization_id;
  if result is null then raise exception 'Organization entitlement not found'; end if;
  return result;
end;
$$;

revoke all on function public.get_organization_billing_summary(uuid) from public,anon;
grant execute on function public.get_organization_billing_summary(uuid) to authenticated;

create or replace function public.set_organization_stripe_customer(target_organization_id uuid,customer_id text)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if current_user not in ('service_role','postgres','supabase_admin') then raise exception 'Service role required'; end if;
  if customer_id is null or customer_id !~ '^cus_[A-Za-z0-9]+$' then raise exception 'Invalid Stripe customer'; end if;
  insert into private.organization_billing(organization_id,stripe_customer_id)
  values(target_organization_id,customer_id)
  on conflict(organization_id) do update set stripe_customer_id=excluded.stripe_customer_id,updated_at=now();
end;
$$;

revoke all on function public.set_organization_stripe_customer(uuid,text) from public,anon,authenticated;
grant execute on function public.set_organization_stripe_customer(uuid,text) to service_role;

create or replace function public.get_stripe_billing_context(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare result jsonb;
begin
  if current_user not in ('service_role','postgres','supabase_admin') then raise exception 'Service role required'; end if;
  select jsonb_build_object('customer_id',billing.stripe_customer_id,'subscription_id',billing.stripe_subscription_id,
    'subscription_status',billing.subscription_status,'organization_name',organization.name)
  into result from public.organizations organization
  left join private.organization_billing billing on billing.organization_id=organization.id
  where organization.id=target_organization_id;
  return result;
end;
$$;

revoke all on function public.get_stripe_billing_context(uuid) from public,anon,authenticated;
grant execute on function public.get_stripe_billing_context(uuid) to service_role;

create or replace function public.resolve_stripe_billing_organization(customer_id text,subscription_id text)
returns uuid language sql stable security definer set search_path=''
as $$
  select case when current_user in ('service_role','postgres','supabase_admin') then billing.organization_id else null end
  from private.organization_billing billing
  where billing.stripe_customer_id=customer_id or billing.stripe_subscription_id=subscription_id
  limit 1;
$$;

revoke all on function public.resolve_stripe_billing_organization(text,text) from public,anon,authenticated;
grant execute on function public.resolve_stripe_billing_organization(text,text) to service_role;

create or replace function public.apply_stripe_subscription_event(
  stripe_event_id text,event_type text,event_created timestamptz,target_organization_id uuid,
  customer_id text,subscription_id text,price_id text,target_plan text,target_subscription_status text,
  target_access_status text,target_staff_limit integer,target_trial_end timestamptz,target_period_end timestamptz,
  target_cancel_at_period_end boolean
)
returns boolean language plpgsql security definer set search_path=''
as $$
declare prior_event timestamptz;
begin
  if current_user not in ('service_role','postgres','supabase_admin') then raise exception 'Service role required'; end if;
  if stripe_event_id is null or event_type is null or event_created is null then raise exception 'Stripe event identity is required'; end if;
  if target_plan not in ('trial','pilot','starter','growth','custom','complimentary') then raise exception 'Invalid billing plan'; end if;
  if target_access_status not in ('trialing','active','grace_period','suspended','canceled') then raise exception 'Invalid access status'; end if;
  if target_staff_limit not between 1 and 10000 then raise exception 'Invalid staff limit'; end if;
  if target_access_status='trialing' and target_trial_end is null then raise exception 'Trial end is required'; end if;

  insert into private.stripe_webhook_events(event_id,event_type,event_created,organization_id)
  values(stripe_event_id,event_type,event_created,target_organization_id)
  on conflict(event_id) do nothing;
  if not found then return false; end if;

  insert into private.organization_billing(organization_id) values(target_organization_id)
  on conflict(organization_id) do nothing;
  select last_event_created into prior_event from private.organization_billing where organization_id=target_organization_id for update;
  if prior_event is not null and prior_event>event_created then return false; end if;

  update private.organization_billing set stripe_customer_id=customer_id,stripe_subscription_id=subscription_id,
    stripe_price_id=price_id,subscription_status=target_subscription_status,cancel_at_period_end=coalesce(target_cancel_at_period_end,false),
    current_period_end=target_period_end,last_event_created=event_created,updated_at=now()
  where organization_id=target_organization_id;

  update public.organization_entitlements set plan=target_plan,access_status=target_access_status,
    trial_ends_at=target_trial_end,current_period_end=target_period_end,staff_limit=target_staff_limit
  where organization_id=target_organization_id;

  insert into private.platform_admin_audit_logs(organization_id,action,reason,after_state)
  values(target_organization_id,'stripe_subscription_synchronized',event_type,jsonb_build_object(
    'event_id',stripe_event_id,'plan',target_plan,'subscription_status',target_subscription_status,
    'access_status',target_access_status,'staff_limit',target_staff_limit,'current_period_end',target_period_end
  ));
  return true;
end;
$$;

revoke all on function public.apply_stripe_subscription_event(text,text,timestamptz,uuid,text,text,text,text,text,text,integer,timestamptz,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.apply_stripe_subscription_event(text,text,timestamptz,uuid,text,text,text,text,text,text,integer,timestamptz,timestamptz,boolean) to service_role;

comment on table private.organization_billing is 'Stripe identifiers and subscription state; never exposed through the Data API.';
comment on function public.apply_stripe_subscription_event(text,text,timestamptz,uuid,text,text,text,text,text,text,integer,timestamptz,timestamptz,boolean) is 'Idempotently synchronizes signed Stripe subscription events into organization entitlements.';
