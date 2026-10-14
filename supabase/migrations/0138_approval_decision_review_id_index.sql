-- migrate:no-transaction

-- W4-08 (docs/audits/2026-10-14-full-stack-audit): deleting a review cascades
-- to its approval decisions with `delete from approval_decision where
-- review_id = $1`, and approval_decision had no index besides its primary
-- key, so each deleted review scanned the table.
--
-- Built concurrently, so writes to approval_decision carry on during the
-- build. That cannot run in a transaction, hence one index per file. A
-- failed concurrent build leaves an invalid index behind and records
-- nothing, so the re-run drops whatever is left before building again.

drop index concurrently if exists approval_decision_review_id_idx;

create index concurrently approval_decision_review_id_idx
  on approval_decision (review_id);

insert into schema_migration(version) values ('0138_approval_decision_review_id_index') on conflict (version) do nothing;
