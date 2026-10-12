begin;

-- ---------------------------------------------------------------------------
-- Alert operators when a completed retention cycle left tenants unretained
-- (plan P04-1).
--
-- A retention cycle (0097) completes once every organisation has succeeded
-- or used up its three runs, and stamps last_cycle_completed_at on the
-- retention tick either way, so tick_cycle_overdue never fires for a tenant
-- whose purge fails every day: its expired Google content is never removed
-- and the only trace was a log line. The health tick now opens a
-- 'tick_cycle_failures' incident (subject 'retention') while the latest
-- completed cycle has organisations it could not retain
-- (lib/server/retention/cycle.ts retentionCycleFailureFinding), and resolves
-- it once a later cycle completes clean.
--
-- Widening a check constraint only validates the existing rows against a
-- superset of the old list.
-- ---------------------------------------------------------------------------

alter table platform_incident
  drop constraint platform_incident_kind_check;
alter table platform_incident
  add constraint platform_incident_kind_check check (
    kind in (
      'stale_heartbeat',
      'google_quota_pressure',
      'tick_never_completed',
      'tick_lock_wedged',
      'tick_cycle_overdue',
      'tick_cycle_failures'
    )
  );

insert into schema_migration (version)
values ('0098_retention_cycle_failure_alert')
on conflict (version) do nothing;

commit;
