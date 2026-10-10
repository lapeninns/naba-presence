begin;

-- ---------------------------------------------------------------------------
-- Tick run ledger (ledger OPS-04).
--
-- ops_heartbeat (0009) recorded one thing per tick: when a run under its
-- advisory lease last completed. That could not tell a tick that never ran
-- from one that ran and kept failing, or from one that kept skipping on a
-- wedged lock, and a tick that had never completed could not be alerted at
-- all, because there was nothing to measure its absence from.
--
-- Each row now also records, for scheduled (cron) runs:
--   last_started_at     the lease was taken and the run began
--   last_skipped_at     the lease was held elsewhere, so the run did nothing
--   consecutive_skips   skips since the last time the lease was taken
--   last_failed_at      the run threw; beat_at does not move
--   last_error_code     the failure's code (an ApiError code or
--                       'internal_error'; never a message)
--   registered_at       when the tick was first known: the grace anchor for
--                       "never completed"
-- and, kept apart so a hand-run refresh cannot stand in for a dead cron:
--   last_manual_completed_at  a session-driven run under the same lease
-- and, for ticks whose work spans several runs (the retention walk):
--   last_cycle_completed_at   the last run that finished a whole cycle
--
-- beat_at becomes nullable so every tick can have a row, with its
-- registered_at, before it has ever completed. Readers already treated a
-- missing row as never completed; a null beat_at means the same.
--
-- Platform-level like the rest of ops_heartbeat: no tenant data, no RLS, read
-- and written outside withTenant.
-- ---------------------------------------------------------------------------

alter table ops_heartbeat
  alter column beat_at drop not null,
  add column last_started_at timestamptz,
  add column last_skipped_at timestamptz,
  add column consecutive_skips integer not null default 0
    check (consecutive_skips >= 0),
  add column last_failed_at timestamptz,
  add column last_error_code text
    check (last_error_code is null or length(last_error_code) <= 64),
  add column last_manual_completed_at timestamptz,
  add column last_cycle_completed_at timestamptz,
  add column registered_at timestamptz not null default now();

-- Every scheduled tick (lib/server/leases.ts LEASE_KEYS), so the grace for a
-- tick that has never completed runs from this migration, not from its first
-- success. Existing rows keep their beat_at and take this moment as their
-- registration.
insert into ops_heartbeat (name)
values
  ('jobs'),
  ('reconcile'),
  ('retention'),
  ('performance'),
  ('keywords'),
  ('presence-resources'),
  ('sweep'),
  ('health')
on conflict (name) do nothing;

alter table platform_incident
  drop constraint platform_incident_kind_check;
alter table platform_incident
  add constraint platform_incident_kind_check check (
    kind in (
      'stale_heartbeat',
      'google_quota_pressure',
      'tick_never_completed',
      'tick_lock_wedged',
      'tick_cycle_overdue'
    )
  );

grant select, insert, update on ops_heartbeat to naba_app_runtime;

insert into schema_migration (version)
values ('0070_ops_tick_runs')
on conflict (version) do nothing;

commit;
