begin;

-- ---------------------------------------------------------------------------
-- Operator alerts for billing that has stopped converging (R2B-06,
-- docs/audits/2026-10-14-full-stack-audit).
--
-- A billing event that used up its retries went `dead` with a log line and a
-- per-organisation audit row, and an hourly reconcile that failed for an
-- organisation was reported only in the cron's JSON. A catalog missing the
-- price a customer subscribed to fails every event and every reconcile for
-- that organisation (`billing_plan_unknown`), so a pilot that has just paid
-- stays a pilot, on full access, while the billing cron looks alive. The
-- health tick now opens one platform incident per organisation for each
-- (lib/server/billing/alerts.ts):
--
--   billing_event_dead    a dead event no successful sync has caught up
--                         with since (provider_synced_at before it died);
--   billing_sync_failing  several background syncs in a row have failed;
--   billing_plan_unknown  the last background sync failed because the
--                         catalog has no plan for the subscribed price.
--
-- organisation_billing gains the run of consecutive failed background syncs
-- (events and reconcile) and the last one's code, written outside the sync's
-- own transaction (which rolled back) and reset by the next successful sync.
-- New columns with constant defaults and a widened check only: no row
-- changes meaning, and code that does not know the columns ignores them.
-- ---------------------------------------------------------------------------

alter table organisation_billing
  add column sync_failures integer not null default 0
    check (sync_failures >= 0),
  add column last_sync_error_code text
    check (last_sync_error_code is null or length(last_sync_error_code) <= 64),
  add column last_sync_failed_at timestamptz;

-- The union of every kind before this file (0121), plus the three billing
-- kinds. A later file that widens the check again must keep all of them.
alter table platform_incident
  drop constraint if exists platform_incident_kind_check;
alter table platform_incident
  add constraint platform_incident_kind_check check (
    kind in (
      'stale_heartbeat',
      'google_quota_pressure',
      'tick_never_completed',
      'tick_lock_wedged',
      'tick_cycle_overdue',
      'tick_cycle_failures',
      'scheduled_post_stuck',
      'scheduled_post_overdue',
      'billing_event_dead',
      'billing_sync_failing',
      'billing_plan_unknown'
    )
  );

-- Platform-level, across tenants like post_schedule_health (0121): counts,
-- instants and stable codes per organisation, nothing from a payload. Rows
-- for organisations with a dead event not yet caught up with, or a failed
-- background sync since the last good one. At most 500 per call.
create or replace function billing_health()
returns table (
  organisation_id uuid,
  dead_events integer,
  oldest_dead_at timestamptz,
  dead_error_code text,
  sync_failures integer,
  last_sync_error_code text,
  last_sync_failed_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with dead as (
    select
      e.organisation_id,
      count(*)::integer as dead_events,
      min(e.processed_at) as oldest_dead_at,
      (array_agg(e.last_error_code order by e.processed_at desc))[1]
        as dead_error_code
    from billing_event e
    join organisation_billing b on b.organisation_id = e.organisation_id
    where e.status = 'dead'
      and (b.provider_synced_at is null or b.provider_synced_at < e.processed_at)
    group by e.organisation_id
  ),
  failing as (
    select
      b.organisation_id,
      b.sync_failures,
      b.last_sync_error_code,
      b.last_sync_failed_at
    from organisation_billing b
    where b.sync_failures > 0
  )
  select
    coalesce(d.organisation_id, f.organisation_id),
    coalesce(d.dead_events, 0),
    d.oldest_dead_at,
    d.dead_error_code,
    coalesce(f.sync_failures, 0),
    f.last_sync_error_code,
    f.last_sync_failed_at
  from dead d
  full join failing f on f.organisation_id = d.organisation_id
  order by 1
  limit 500
$$;

revoke all on function billing_health() from public;
grant execute on function billing_health() to naba_app_runtime;

insert into schema_migration (version)
values ('0146_billing_operator_alerts') on conflict (version) do nothing;
commit;
