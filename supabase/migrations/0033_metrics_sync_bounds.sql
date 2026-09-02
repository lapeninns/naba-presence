begin;

-- ---------------------------------------------------------------------------
-- Metrics ingestion bounds.
--
-- `performance` and `keywords` checkpoints were the only claimable rows with
-- no ceiling. failPerformanceSync / failKeywordSync re-armed them on every
-- failure forever, so a location whose Google grant was revoked burned
-- provider calls on every tick, took a slot from the per-tick location budget
-- ahead of healthy locations, and sat permanently due in `dueJobBacklog`.
-- Webhooks already retire at `retry_count >= 5` (0029); this is the
-- checkpoint equivalent.
--
-- A column rather than a new `status` value: 'failed' keeps meaning failed to
-- every existing reader -- the analytics endpoints still surface
-- `last_error_code` as an unavailable reason and `checkpointFailures24h`
-- still raises the ticket once -- and the two claim predicates only add
-- `dead_lettered_at is null`. A retired row is settled with
-- `next_attempt_at = null`, which is what drops it out of the backlog gauge
-- (`status in ('pending','failed') and next_attempt_at <= now()`).
-- ---------------------------------------------------------------------------

alter table sync_checkpoint
  add column if not exists dead_lettered_at timestamptz;

-- `attempt_count` changes meaning here: it was a lifetime claim counter that
-- nothing ever read, and it is now the consecutive-failure count the ceiling
-- is compared against (both modules already reset it to 0 on success). A
-- location syncing every six hours for a week carries roughly 28, so without
-- this reset the first failure after deploy would exceed the ceiling and
-- retire the whole fleet in one tick.
update sync_checkpoint
set attempt_count = 0
where sync_type in ('performance', 'keywords');

insert into schema_migration (version)
values ('0033_metrics_sync_bounds')
on conflict (version) do nothing;

commit;
