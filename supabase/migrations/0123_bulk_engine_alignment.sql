begin;

-- P09-R1: align main's bulk listing engine (0080) with the plan's limits.
--
--   * At most 50 listings per batch (was 100).
--   * A preview can be approved for 15 minutes; an approved batch dispatches
--     for 24 hours after approval (was 24 hours from the preview), enforced
--     per child at claim time and again just before the provider write. A
--     child that misses the window ends `expired` and is never sent.
--   * At most 2 running children per organisation, across batches, and never
--     two running children for the same (location, resource key).
--   * Each child freezes the Google target it was previewed against
--     (connection, credential generation, location resource name); the runner
--     refuses to write when any of them moved.
--   * The claim only serves organisations with the `bulk_actions` feature on.
--
-- Rows written before this migration are kept: they get a 15-minute preview
-- window from their creation, approved rows keep their old 24-hour deadline,
-- non-terminal children are frozen against their listing's current link, and
-- an operation over the new cap is marked `legacy_over_cap` so its status can
-- still change.

alter table bulk_listing_operation
  add column preview_expires_at timestamptz,
  add column dispatch_expires_at timestamptz,
  add column legacy_over_cap boolean not null default false;

update bulk_listing_operation
set preview_expires_at = least(approval_expires_at, created_at + interval '15 minutes');
update bulk_listing_operation
set dispatch_expires_at = approval_expires_at
where approved_at is not null;
update bulk_listing_operation
set legacy_over_cap = true
where cardinality(target_location_ids) > 50;

alter table bulk_listing_operation
  alter column preview_expires_at set default now() + interval '15 minutes',
  alter column preview_expires_at set not null,
  add constraint bulk_listing_operation_dispatch_after_approval
    check (dispatch_expires_at is null or approved_at is not null);

-- `legacy_over_cap` is set only by this migration. The runtime role has
-- table-wide insert and update (0080), so a trigger keeps it that way: a new
-- row cannot be legacy, and no row can become legacy later. The cap stays
-- enforceable for every row this migration did not grandfather.
alter table bulk_listing_operation
  drop constraint bulk_listing_operation_target_location_ids_check,
  add constraint bulk_listing_operation_target_cap check (
    cardinality(target_location_ids) >= 1
    and (cardinality(target_location_ids) <= 50 or legacy_over_cap)
  );

create function bulk_listing_operation_legacy_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.legacy_over_cap and (tg_op = 'INSERT' or not old.legacy_over_cap) then
    raise exception 'legacy_over_cap is set only by migration 0123'
      using errcode = 'check_violation';
  end if;
  -- A grandfathered batch keeps its targets; it cannot grow.
  if tg_op = 'UPDATE' and old.legacy_over_cap
     and not (new.target_location_ids <@ old.target_location_ids) then
    raise exception 'a legacy over-cap batch cannot gain targets'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger bulk_listing_operation_legacy_guard
  before insert or update of legacy_over_cap, target_location_ids on bulk_listing_operation
  for each row execute function bulk_listing_operation_legacy_guard();

alter table bulk_listing_child
  add column resource_key text,
  add column connection_id uuid,
  add column credential_generation integer,
  add column google_location_name text;

update bulk_listing_child c
set resource_key = case o.operation
  when 'attributes' then 'attributes'
  when 'place_action' then 'place_actions'
  else 'hours'
end
from bulk_listing_operation o
where o.id = c.operation_id;

update bulk_listing_child c
set connection_id = e.google_connection_id,
    credential_generation = g.credential_generation,
    google_location_name = e.google_location_name
from location_link ll
join external_location e on e.id = ll.external_location_id
join google_connection g on g.id = e.google_connection_id
where ll.location_id = c.location_id
  and ll.is_active = true
  and c.eligibility = 'eligible'
  and c.status in ('previewed', 'queued', 'running', 'failed', 'ambiguous');

alter table bulk_listing_child
  alter column resource_key set not null,
  add constraint bulk_listing_child_resource_key_check
    check (resource_key in ('hours', 'attributes', 'place_actions')),
  drop constraint bulk_listing_child_status_check,
  add constraint bulk_listing_child_status_check check (status in (
    'previewed', 'skipped', 'queued', 'running', 'succeeded', 'failed', 'conflict', 'ambiguous', 'cancelled', 'expired'
  ));

create index bulk_listing_child_running_idx
  on bulk_listing_child (organisation_id, location_id, resource_key)
  where status = 'running';

-- The runner tick's claim across tenants. Serialised by a transaction lock so
-- two concurrent ticks cannot both see a free slot. Order of work:
--   1. A running child whose lease ran out may already have reached Google,
--      so it becomes ambiguous (settled by a later readback), never re-run.
--   2. Operations past their window expire: a preview after 15 minutes, an
--      approved or running batch 24 hours after approval. A preview or an
--      approved batch is finished and audited (`bulk_listing.expired`) here.
--      Their unstarted children (previewed or queued) become `expired`.
--   3. Of the queued children whose organisation has `bulk_actions` on and
--      whose (location, resource key) has nothing running, at most one per
--      resource is chosen, and at most min(p_per_org, 2) minus what already
--      runs per organisation, oldest first.
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
    lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  from chosen where c.id = chosen.id
  returning c.organisation_id, c.id;
end $$;
revoke all on function claim_due_bulk_children(integer, integer, integer) from public;
grant execute on function claim_due_bulk_children(integer, integer, integer) to naba_app_runtime;

-- Running operations with nothing left to run (for example every child
-- expired at claim time), so the runner can finish them, audit them and
-- raise `bulk_completed_with_failures` once.
create function bulk_operations_ready_to_finish(p_limit integer)
returns table (organisation_id uuid, operation_id uuid)
language sql security definer set search_path = public as $$
  select o.organisation_id, o.id
  from bulk_listing_operation o
  where o.status = 'running'
    and not exists (
      select 1 from bulk_listing_child c
      where c.operation_id = o.id and c.status in ('previewed', 'queued', 'running')
    )
  order by o.updated_at, o.id
  limit p_limit
$$;
revoke all on function bulk_operations_ready_to_finish(integer) from public;
grant execute on function bulk_operations_ready_to_finish(integer) to naba_app_runtime;

insert into schema_migration(version) values ('0123_bulk_engine_alignment') on conflict (version) do nothing;
commit;
