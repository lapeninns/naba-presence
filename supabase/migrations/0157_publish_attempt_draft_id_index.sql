-- migrate:no-transaction

-- W4-08 follow-up (docs/audits/2026-10-14-full-stack-audit): deleting a draft
-- sets its publish attempts' draft_id to null with `update publish_attempt
-- set draft_id = null where draft_id = $1`, and no index on publish_attempt
-- leads with draft_id. Drafts go when their review does (retention's
-- disconnectedReviews purge), so each deleted draft scanned publish_attempt.
--
-- Built concurrently, so writes to publish_attempt carry on during the
-- build. That cannot run in a transaction, hence one index per file. A
-- failed concurrent build leaves an invalid index behind and records
-- nothing, so the re-run drops whatever is left before building again.

drop index concurrently if exists publish_attempt_draft_id_idx;

create index concurrently if not exists publish_attempt_draft_id_idx
  on publish_attempt (draft_id);

insert into schema_migration(version) values ('0157_publish_attempt_draft_id_index') on conflict (version) do nothing;
