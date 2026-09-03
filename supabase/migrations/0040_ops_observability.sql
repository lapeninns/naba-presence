begin;

-- ---------------------------------------------------------------------------
-- Operational observability: per-tick liveness, and indexes for the two new
-- fleet-wide health aggregates.
--
-- No schema change is needed for the per-tick heartbeat itself. ops_heartbeat
-- (0009) is keyed by name, and withAdvisoryLock now stamps one row per lease
-- -- 'jobs', 'reconcile', 'retention', 'performance', 'keywords' and
-- 'presence-resources' -- on a run that held the lease and returned.
-- The pre-existing 'scheduler' row is left alone and keeps its meaning: the
-- jobs tick writes it even while paused, so it says the scheduler process
-- reached the web process, not that any particular tick did its work. The
-- runtime role already holds select/insert/update on the table.
--
-- What does need support is the reading side. /api/operations/health runs its
-- per-tenant counters once per organisation on every platform poll, and this
-- release adds two predicates to that loop with nothing behind them:
--
--   reconcile freshness   max(finished_at) over one sync_type. Without the
--                         partial index this is a scan of the tenant's whole
--                         checkpoint set per poll, per organisation.
--
--   purge pressure        the disconnected-connection window. The retention
--                         cron already runs this predicate twice per tenant
--                         per pass (the purge itself and the held-location
--                         count), so the index pays for itself there too.
--
-- Both are partial on the status they filter, so they stay small: a tenant
-- has one reconcile checkpoint per linked location and few disconnected
-- connections.
-- ---------------------------------------------------------------------------

create index if not exists sync_checkpoint_reconcile_finished_idx
  on sync_checkpoint (organisation_id, finished_at desc)
  where sync_type = 'reconcile';

create index if not exists google_connection_purge_due_idx
  on google_connection (organisation_id, purge_due_at)
  where status = 'disconnected';

insert into schema_migration (version)
values ('0040_ops_observability')
on conflict (version) do nothing;

commit;
