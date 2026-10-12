begin;

-- P09-R3: bulk children write through the surface pipelines, with receipts.
--
--   * Each child records the receipt (mutation_operation, 0086) its write
--     went out under, so GET /api/mutations/{id} answers for a bulk write and
--     the `mutation_recover` job (0092) reads an uncertain one back. The
--     composite key keeps the receipt in the child's own organisation.
--   * Hours children publish through the hours editor's own path and its
--     attempt table (hours_sync_attempt). Attribute and action-link children
--     have no receipt-recording editor path (their editors run reviewed
--     change sets), so they record their attempts here, in
--     bulk_listing_write_attempt, which the recovery registry reads back
--     (lib/server/bulk-families/write-attempts.ts).
--   * bulk_children_to_reconcile(): unresolved children whose receipt has
--     since settled (recovery read Google back), for the runner to settle
--     from the receipt without sending anything again.

-- The receipt key is mutation_operation's existing (organisation_id, id)
-- unique key (0094 mutation_operation_organisation_id_id_key).
alter table bulk_listing_child
  add constraint bulk_listing_child_tenant_key unique (organisation_id, id),
  add column mutation_operation_id uuid,
  add constraint bulk_listing_child_mutation_operation_fk
    foreign key (organisation_id, mutation_operation_id)
    references mutation_operation (organisation_id, id),
  -- An hours child saves the change as a new canonical revision before it
  -- publishes: { revision, payload } is that revision and the schedule it
  -- replaced, so a write recovery later reads back as not applied puts the
  -- saved schedule back (only while that revision is still current).
  add column hours_restore jsonb;

create index bulk_listing_child_receipt_idx
  on bulk_listing_child (mutation_operation_id)
  where mutation_operation_id is not null;

create table bulk_listing_write_attempt (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  child_id uuid not null,
  location_id uuid references location(id) on delete set null,
  family text not null check (family in ('attributes', 'place_action')),
  idempotency_key text not null check (length(idempotency_key) between 16 and 256),
  status text not null check (status in (
    'validating', 'validated', 'publishing', 'succeeded', 'failed', 'ambiguous'
  )),
  actor_user_id uuid references app_user(id) on delete set null,
  external_location_id uuid references external_location(id) on delete set null,
  google_location_name text not null check (length(google_location_name) <= 512),
  -- What the readback must find: the attributes and mask, or the action
  -- link plan (create / update by name / delete by name) and the link names
  -- the listing held before.
  intended jsonb not null,
  provider_error_code text check (provider_error_code is null or length(provider_error_code) <= 128),
  provider_response_hash text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint bulk_listing_write_attempt_key unique (organisation_id, idempotency_key),
  constraint bulk_listing_write_attempt_child_fk
    foreign key (organisation_id, child_id)
    references bulk_listing_child (organisation_id, id) on delete cascade
);
create index bulk_listing_write_attempt_child_idx
  on bulk_listing_write_attempt (organisation_id, child_id);

alter table bulk_listing_write_attempt enable row level security;
alter table bulk_listing_write_attempt force row level security;
create policy tenant_isolation on bulk_listing_write_attempt
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, update on bulk_listing_write_attempt to naba_app_runtime;

-- Across tenants, for the runner tick: children left `ambiguous` whose
-- receipt is no longer waiting on Google (recovery, or another request,
-- settled it).
create function bulk_children_to_reconcile(p_limit integer)
returns table (organisation_id uuid, child_id uuid)
language sql security definer set search_path = public as $$
  select c.organisation_id, c.id
  from bulk_listing_child c
  join mutation_operation m
    on m.organisation_id = c.organisation_id and m.id = c.mutation_operation_id
  where c.status = 'ambiguous'
    and m.state in ('confirmed_applied', 'awaiting_confirmation', 'failed', 'rejected')
  order by m.updated_at, c.id
  limit p_limit
$$;
revoke all on function bulk_children_to_reconcile(integer) from public;
grant execute on function bulk_children_to_reconcile(integer) to naba_app_runtime;

-- 0260's claim, unchanged except that a claim clears the previous claim's
-- receipt and hours restore point: a child only ever points at the receipt
-- of its latest send, so an interrupted claim is never settled from an older
-- claim's receipt.
create or replace function claim_due_bulk_children(p_limit integer, p_lease_seconds integer, p_per_org integer)
returns table (organisation_id uuid, child_id uuid)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_per_org integer := least(greatest(coalesce(p_per_org, 0), 0), 2);
begin
  perform pg_advisory_xact_lock(hashtextextended('naba:claim_due_bulk_children', 0));

  update bulk_listing_child set status = 'ambiguous', result_code = 'execution_interrupted', finished_at = now(), lease_expires_at = null
  where status = 'running' and lease_expires_at < now();

  -- An operation that expires before it ran is finished here, with one
  -- audit row (the status changes once, so it is written once). A running
  -- batch past its window is finished by the runner (`finishOperation`).
  with expired as (
    update bulk_listing_operation set status = 'expired', finished_at = now(), updated_at = now()
    where (status = 'previewed' and preview_expires_at <= now())
       or (status = 'approved' and coalesce(dispatch_expires_at, now()) <= now())
    returning id, organisation_id, approved_by, approved_at
  )
  insert into audit_log (organisation_id, actor_user_id, action, subject_type, subject_id, metadata)
  select e.organisation_id, e.approved_by, 'bulk_listing.expired', 'bulk_listing_operation', e.id::text,
    jsonb_build_object('stage', case when e.approved_at is null then 'preview' else 'dispatch' end)
  from expired e;
  -- A preview that was never approved expired at the 15-minute stage, not
  -- at the 24-hour dispatch window, and says so.
  update bulk_listing_child c set status = 'expired',
    result_code = case when o.approved_at is null then 'preview_expired' else 'dispatch_expired' end,
    finished_at = now(), next_attempt_at = null
  from bulk_listing_operation o
  where o.id = c.operation_id
    and c.status in ('previewed', 'queued')
    and (o.status = 'expired' or (o.status = 'running' and coalesce(o.dispatch_expires_at, now()) <= now()));

  return query
  with due as (
    select c.id, c.organisation_id, c.location_id, c.resource_key, coalesce(c.next_attempt_at, c.created_at) as due_at
    from bulk_listing_child c join bulk_listing_operation o on o.id = c.operation_id
    where c.status = 'queued' and o.status = 'running' and coalesce(c.next_attempt_at, now()) <= now()
      and o.dispatch_expires_at > now()
      and exists (
        select 1 from organisation_feature f
        where f.organisation_id = c.organisation_id and f.feature = 'bulk_actions' and f.enabled
      )
      and not exists (
        select 1 from bulk_listing_child r
        where r.organisation_id = c.organisation_id and r.location_id = c.location_id
          and r.resource_key = c.resource_key and r.status = 'running'
      )
  ), one_per_resource as (
    select distinct on (due.organisation_id, due.location_id, due.resource_key) due.*
    from due
    order by due.organisation_id, due.location_id, due.resource_key, due.due_at, due.id
  ), busy as (
    select r.organisation_id, count(*)::int as n
    from bulk_listing_child r where r.status = 'running' group by r.organisation_id
  ), ranked as (
    select p.id, p.due_at, coalesce(busy.n, 0) as running,
      row_number() over (partition by p.organisation_id order by p.due_at, p.id) as rn
    from one_per_resource p left join busy on busy.organisation_id = p.organisation_id
  ), chosen as (
    select ranked.id from ranked where ranked.rn <= v_per_org - ranked.running order by ranked.due_at, ranked.id limit p_limit
  )
  update bulk_listing_child c set status = 'running', attempts = c.attempts + 1, started_at = now(),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    mutation_operation_id = null, hours_restore = null
  from chosen where c.id = chosen.id
  returning c.organisation_id, c.id;
end $$;
revoke all on function claim_due_bulk_children(integer, integer, integer) from public;
grant execute on function claim_due_bulk_children(integer, integer, integer) to naba_app_runtime;

insert into schema_migration(version) values ('0262_bulk_child_receipts') on conflict (version) do nothing;
commit;
