begin;

-- ---------------------------------------------------------------------------
-- gbp_management_mutation.started_at (P03-S4).
--
-- Business information, attributes and industry writes now run through
-- runGbpWrite (lib/server/gbp-write.ts) on gbpManagementAttemptStore, which
-- dates an in-flight attempt by this column: recovery can then tell a write
-- interrupted past the grace window from one still running, and a re-armed
-- row restarts its clock (the store resets it to now()). The retention
-- cron's stranded-attempt reaper ages rows off it as well, instead of
-- created_at.
--
-- Additive with a constant default, so existing rows read as started when
-- the migration ran: an in-flight row from before it is reaped no earlier
-- than it would have been. No backfill. The existing forced tenant RLS and
-- table-level runtime grants cover the new column.
-- ---------------------------------------------------------------------------

alter table gbp_management_mutation
  add column started_at timestamptz not null default now();

insert into schema_migration (version) values ('0088_gbp_management_started_at')
on conflict (version) do nothing;

commit;
