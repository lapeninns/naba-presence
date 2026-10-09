begin;

-- Observation evidence is separate from publication baselines and from the
-- scheduler's attempt bookkeeping. A delayed scheduler completion must not
-- advance the timestamp of a newer snapshot. Profile/menu reads share the observation timing/error fields.
alter table presence_resource_reconcile_state
  add column reconciliation_started_at timestamptz,
  add column observed_google_hash text,
  add column comparison_canonical_hash text,
  add column comparison_google_hash text,
  add column observed_at timestamptz,
  add column observation_attempted_at timestamptz,
  add column observation_error_code text,
  add column comparison_blocked boolean not null default false;

-- Existing forced tenant RLS and organisation/location/resource unique index
-- cover these additive columns. No baseline or historical observation backfill.
insert into schema_migration (version)
values ('0058_hours_observations') on conflict (version) do nothing;
commit;
