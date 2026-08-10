-- Greenhouse Ledger Phase 3: staff invitations, recurring care, alerts, photos, and audit history
alter table public.care_tasks
  add column recurrence_days integer check (recurrence_days is null or recurrence_days > 0),
  add column photo_path text;

alter table public.inventory_batches add column photo_path text;
alter table public.plant_catalog add column photo_path text;

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(trim(email))),
  role public.organization_role not null default 'worker' check (role <> 'owner'),
  code uuid not null default gen_random_uuid() unique,
  invited_by uuid not null default auth.uid() references public.profiles(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.organization_invitations enable row level security;
create policy invitations_manage on public.organization_invitations for all to authenticated
  using (private.has_organization_role(organization_id, array['owner','manager']::public.organization_role[]))
  with check (private.has_organization_role(organization_id, array['owner','manager']::public.organization_role[]) and invited_by = (select auth.uid()));
grant select, insert, update, delete on public.organization_invitations to authenticated;
create index organization_invitations_org_idx on public.organization_invitations(organization_id, created_at desc);
create index care_tasks_assigned_status_due_idx on public.care_tasks(assigned_to, status, due_at);

create or replace function private.shares_organization(target_profile_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id = mine.organization_id
    where mine.profile_id = (select auth.uid()) and theirs.profile_id = target_profile_id
  );
$$;
revoke all on function private.shares_organization(uuid) from public, anon, authenticated;
create policy profiles_select_colleague on public.profiles for select to authenticated using (private.shares_organization(id));

create or replace function public.accept_organization_invitation(invitation_code uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare invitation public.organization_invitations%rowtype;
declare user_email text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select lower(email) into user_email from auth.users where id = (select auth.uid());
  select * into invitation from public.organization_invitations
    where code = invitation_code and accepted_at is null and expires_at > now() for update;
  if invitation.id is null then raise exception 'Invitation is invalid or expired'; end if;
  if invitation.email <> user_email then raise exception 'Invitation email does not match this account'; end if;
  insert into public.organization_members(organization_id,profile_id,role)
    values(invitation.organization_id,(select auth.uid()),invitation.role)
    on conflict (organization_id,profile_id) do update set role=excluded.role;
  update public.organization_invitations set accepted_at=now() where id=invitation.id;
  insert into public.activity_logs(organization_id,actor_id,entity_type,entity_id,action,details)
    values(invitation.organization_id,(select auth.uid()),'staff',auth.uid(),'invitation_accepted',jsonb_build_object('role',invitation.role));
  return invitation.organization_id;
end;
$$;
revoke all on function public.accept_organization_invitation(uuid) from public, anon;
grant execute on function public.accept_organization_invitation(uuid) to authenticated;

create or replace function public.complete_care_task(target_task_id uuid)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare task public.care_tasks%rowtype;
declare next_id uuid;
begin
  select * into task from public.care_tasks where id=target_task_id for update;
  if task.id is null then raise exception 'Task not found or unavailable'; end if;
  if task.status in ('completed','cancelled') then raise exception 'Task is already closed'; end if;
  update public.care_tasks set status='completed',completed_at=now(),completed_by=auth.uid() where id=task.id;
  if task.recurrence_days is not null then
    insert into public.care_tasks(organization_id,batch_id,location_id,task_type,title,notes,due_at,assigned_to,recurrence_days,created_by)
    values(task.organization_id,task.batch_id,task.location_id,task.task_type,task.title,task.notes,
      coalesce(task.due_at,now()) + make_interval(days=>task.recurrence_days),task.assigned_to,task.recurrence_days,auth.uid()) returning id into next_id;
  end if;
  insert into public.activity_logs(organization_id,actor_id,entity_type,entity_id,action,details)
    values(task.organization_id,auth.uid(),'care_task',task.id,'completed',jsonb_build_object('next_task_id',next_id));
  return next_id;
end;
$$;
revoke all on function public.complete_care_task(uuid) from public, anon;
grant execute on function public.complete_care_task(uuid) to authenticated;

create or replace function private.log_phase_3_changes()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.activity_logs(organization_id,actor_id,entity_type,entity_id,action,details)
  values(new.organization_id,auth.uid(),tg_argv[0],new.id,tg_argv[1],'{}');
  return new;
end;
$$;
revoke all on function private.log_phase_3_changes() from public, anon, authenticated;
create trigger care_task_created after insert on public.care_tasks for each row execute function private.log_phase_3_changes('care_task','created');
create trigger invitation_created after insert on public.organization_invitations for each row execute function private.log_phase_3_changes('staff_invitation','created');
