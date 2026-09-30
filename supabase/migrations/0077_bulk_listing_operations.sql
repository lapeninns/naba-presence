begin;

-- WP6: reviewed bulk changes across up to 100 explicitly selected listings.
-- The preview freezes the targets, each location's current Google value,
-- the merged value to send and its exact update mask. A batch is not a
-- distributed transaction: each child succeeds or fails on its own.

create table bulk_listing_operation (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  operation text not null check (operation in ('regular_hours', 'special_hours', 'more_hours', 'attributes', 'place_action')),
  input jsonb not null,
  target_location_ids uuid[] not null check (cardinality(target_location_ids) between 1 and 100),
  preview_hash text not null check (preview_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'previewed' check (status in (
    'previewed', 'approved', 'running', 'completed', 'completed_with_failures', 'cancelled', 'expired'
  )),
  requested_by uuid not null references app_user(id) on delete restrict,
  approved_by uuid references app_user(id) on delete restrict,
  approved_at timestamptz,
  require_two_person_approval boolean not null,
  skipped_acknowledged boolean not null default false,
  approval_expires_at timestamptz not null default now() + interval '24 hours',
  execute_requested_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bulk_listing_operation_recent_idx on bulk_listing_operation (organisation_id, created_at desc);

create table bulk_listing_child (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  operation_id uuid not null references bulk_listing_operation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  eligibility text not null check (eligibility in ('eligible', 'skipped')),
  skip_reason text,
  current_value jsonb,
  proposed_value jsonb,
  update_mask text[] not null default array[]::text[],
  baseline_hash text,
  status text not null check (status in (
    'previewed', 'skipped', 'queued', 'running', 'succeeded', 'failed', 'conflict', 'ambiguous', 'cancelled'
  )),
  confirmation_state text not null default 'unrecorded' check (confirmation_state in ('unrecorded', 'confirmed', 'unresolved')),
  result_code text,
  attempts integer not null default 0,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (operation_id, location_id),
  check (eligibility = 'eligible' or status in ('skipped', 'cancelled'))
);
create index bulk_listing_child_due_idx on bulk_listing_child (next_attempt_at) where status = 'queued';
create index bulk_listing_child_operation_idx on bulk_listing_child (operation_id, status);

alter table bulk_listing_operation enable row level security;
alter table bulk_listing_operation force row level security;
create policy tenant_isolation on bulk_listing_operation
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, update on bulk_listing_operation to naba_app_runtime;

alter table bulk_listing_child enable row level security;
alter table bulk_listing_child force row level security;
create policy tenant_isolation on bulk_listing_child
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, update on bulk_listing_child to naba_app_runtime;

-- The runner tick's claim across tenants. A running child whose lease ran
-- out may already have reached Google, so it becomes ambiguous (settled by a
-- later readback) instead of running again. Fair: at most p_per_org children
-- per organisation per call, oldest first.
create function claim_due_bulk_children(p_limit integer, p_lease_seconds integer, p_per_org integer)
returns table (organisation_id uuid, child_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  update bulk_listing_child set status = 'ambiguous', result_code = 'execution_interrupted', finished_at = now(), lease_expires_at = null
  where status = 'running' and lease_expires_at < now();
  return query
  with due as (
    select c.id, c.organisation_id, coalesce(c.next_attempt_at, c.created_at) as due_at
    from bulk_listing_child c join bulk_listing_operation o on o.id = c.operation_id
    where c.status = 'queued' and o.status = 'running' and coalesce(c.next_attempt_at, now()) <= now()
  ), ranked as (
    select due.*, row_number() over (partition by due.organisation_id order by due.due_at, due.id) as rn from due
  ), chosen as (
    select id from ranked where rn <= p_per_org order by due_at, id limit p_limit
  )
  update bulk_listing_child c set status = 'running', attempts = c.attempts + 1, started_at = now(),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  from chosen where c.id = chosen.id
  returning c.organisation_id, c.id;
end $$;
revoke all on function claim_due_bulk_children(integer, integer, integer) from public;
grant execute on function claim_due_bulk_children(integer, integer, integer) to naba_app_runtime;

insert into schema_migration(version) values ('0077_bulk_listing_operations') on conflict (version) do nothing;
commit;
