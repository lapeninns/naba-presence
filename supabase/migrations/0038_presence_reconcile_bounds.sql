begin;

-- ---------------------------------------------------------------------------
-- Presence reconciliation bounds.
--
-- The presence-resources sweep had an ordering (least-recently-attempted
-- first, 0023) but no dueness filter, unlike the performance and keyword
-- sweeps which claim only due locations. Every tick therefore re-walked its
-- head-of-order organisations - six live Google reads per location, seconds of
-- request pacing each - so a fleet larger than one page never reached its
-- tail, and a location whose Google grant was revoked burned the same six
-- calls every fifteen minutes forever.
--
-- `next_attempt_at` is the sync_checkpoint equivalent for this table: the
-- route sets it to a short interval after a successful attempt and a long one
-- after a failure, and the location query skips locations whose resources are
-- all still in the future.
--
-- Defaulting to now() leaves every existing row immediately due, so the first
-- tick after deploy behaves exactly as it does today and the fleet settles
-- into the cadence from there.
-- ---------------------------------------------------------------------------

alter table presence_resource_reconcile_state
  add column if not exists next_attempt_at timestamptz not null default now();

-- The due predicate is min(next_attempt_at) grouped by location within one
-- organisation; presence_resource_reconcile_due_idx (0023) is ordered by
-- last_attempt_at and cannot serve it.
create index if not exists presence_resource_reconcile_next_attempt_idx
  on presence_resource_reconcile_state (organisation_id, location_id, next_attempt_at);

insert into schema_migration (version)
values ('0038_presence_reconcile_bounds')
on conflict (version) do nothing;

commit;
