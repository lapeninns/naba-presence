begin;

-- ---------------------------------------------------------------------------
-- Persisted retention cycles (plan P04-1, ledger DATA-01).
--
-- Retention used to run as one daily cron fire that purged the first page of
-- organisations (100 at most, fewer if the 45s budget ran out) and returned a
-- cursor nobody followed on Vercel: every organisation past the first page was
-- never retained. A five-minute dispatcher now works through one cycle per UTC
-- day, opened at or after 03:00, and keeps its progress here so each fire
-- resumes where the last one stopped (lib/server/retention/cycle.ts).
--
-- retention_cycle       one row per UTC day's cycle
--   enumeration_cursor        the last organisation_id copied into the cycle
--   enumeration_completed_at  set once organisation_job_route has no more
--   enumerated / succeeded / failed  per-organisation counts, kept apart so
--                             "walked everyone" and "retained everyone" are
--                             different facts
--   status                    'running' until every enumerated organisation
--                             has succeeded or used up its attempts
--
-- retention_cycle_org   one row per organisation in a cycle
--   status        'pending' (not yet retained), 'succeeded', 'failed'
--   attempts      runs started on it, counted before each run, so a fire the
--                 platform killed mid-organisation still counts against it
--   last_error_code  a stable machine code, never a message
--
-- Platform-level like cron_cursor and ops_heartbeat: the walk spans tenants,
-- holds no tenant content (organisation ids and counts only), has no RLS and
-- is read and written outside withTenant. The runtime role prunes cycles past
-- their reporting window, so it may delete.
-- ---------------------------------------------------------------------------

create table retention_cycle (
  id uuid primary key default gen_random_uuid(),
  cycle_date date not null unique,
  started_at timestamptz not null default now(),
  enumeration_cursor uuid,
  enumeration_completed_at timestamptz,
  enumerated integer not null default 0 check (enumerated >= 0),
  succeeded integer not null default 0 check (succeeded >= 0),
  failed integer not null default 0 check (failed >= 0),
  status text not null default 'running'
    check (status in ('running', 'completed')),
  completed_at timestamptz,
  check ((status = 'completed') = (completed_at is not null))
);

create index retention_cycle_running_idx
  on retention_cycle (cycle_date)
  where status = 'running';

create table retention_cycle_org (
  cycle_id uuid not null references retention_cycle(id) on delete cascade,
  organisation_id uuid not null
    references organisation(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error_code text
    check (last_error_code is null or length(last_error_code) <= 64),
  finished_at timestamptz,
  primary key (cycle_id, organisation_id)
);

create index retention_cycle_org_open_idx
  on retention_cycle_org (cycle_id, organisation_id)
  where status <> 'succeeded';

create index retention_cycle_org_organisation_idx
  on retention_cycle_org (organisation_id);

grant select, insert, update, delete on retention_cycle to naba_app_runtime;
grant select, insert, update, delete on retention_cycle_org to naba_app_runtime;

insert into schema_migration (version)
values ('0097_retention_cycle')
on conflict (version) do nothing;

commit;
