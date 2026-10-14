begin;

-- ---------------------------------------------------------------------------
-- Expiring fleet leases (WP-12; audit 2026-10-14, W8-05).
--
-- Each scheduled tick (lib/server/leases.ts LEASE_KEYS) used to hold a
-- session advisory lock on a dedicated session-pooler connection. That lock
-- has no expiry: it goes only when the holder unlocks or Postgres sees the
-- connection close, so a function frozen mid-tick with its socket still open
-- could hold a tick's lock for as long as the pooler kept the connection,
-- and every later fire was skipped.
--
-- A tick now takes a row here instead: the holder writes its own id and an
-- expiry, and anyone may take the row once the expiry has passed. The
-- expiry is set above every leased route's maxDuration, so a healthy tick
-- never loses it, and a stranded one is free again within that bound.
--
-- Platform-level like ops_heartbeat (0009): no tenant data, no RLS. Rows are
-- created on first use and never deleted; a release only ends the expiry.
-- ---------------------------------------------------------------------------

create table if not exists fleet_lease (
  name text primary key,
  holder uuid not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

grant select, insert, update on fleet_lease to naba_app_runtime;

insert into schema_migration (version) values ('0148_fleet_lease')
on conflict (version) do nothing;

commit;
