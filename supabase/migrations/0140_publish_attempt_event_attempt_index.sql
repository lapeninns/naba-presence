-- migrate:no-transaction

-- W4-08 follow-up (docs/audits/2026-10-14-full-stack-audit): deleting a
-- publish attempt cascades to its events with `delete from
-- publish_attempt_event where publish_attempt_id = $1`, and
-- publish_attempt_event had no index besides its primary key. Events are
-- append-only and go only under retention (app.retention_run), when a
-- purged review takes its reply and that reply's attempts with it, so each
-- deleted attempt scanned the whole event log.
--
-- Built concurrently, so event inserts carry on during the build. That
-- cannot run in a transaction, hence one index per file. A failed
-- concurrent build leaves an invalid index behind and records nothing, so
-- the re-run drops whatever is left before building again.

drop index concurrently if exists publish_attempt_event_attempt_idx;

create index concurrently if not exists publish_attempt_event_attempt_idx
  on publish_attempt_event (publish_attempt_id);

insert into schema_migration(version) values ('0140_publish_attempt_event_attempt_index') on conflict (version) do nothing;
