begin;

-- ---------------------------------------------------------------------------
-- In-flight GBP attempts: give food menus the start timestamp recovery needs.
--
-- runGbpWrite now recovers an attempt left in flight by an interrupted
-- request instead of 409ing it until its retention TTL expires
-- (docs/architecture.md, "Ambiguous, failed, and interrupted writes").
-- Deciding that a row was interrupted rather than still running needs its
-- start time, and food_menus_sync_attempt is the one resume-mode attempt
-- table without one -- hours_sync_attempt (0013) and profile_sync_attempt
-- (0016) both have `started_at`. A row with no start time keeps the plain
-- 409, so this column is what switches Food Menus onto the recovery path.
--
-- Recovery happens inside the next request for the same key rather than in an
-- out-of-band reaper, so no lease column is added here: there is nothing to
-- expire, and reclaim_expired_jobs stays a job-runner concern.
-- ---------------------------------------------------------------------------

alter table food_menus_sync_attempt
  add column if not exists started_at timestamptz;

-- Backfill from created_at rather than accepting now(): an existing stranded
-- row is months old and must read as interrupted immediately, not as one that
-- has only just started.
update food_menus_sync_attempt
set started_at = created_at
where started_at is null;

alter table food_menus_sync_attempt
  alter column started_at set default now(),
  alter column started_at set not null;

insert into schema_migration (version)
values ('0036_gbp_attempt_leases')
on conflict (version) do nothing;

commit;
