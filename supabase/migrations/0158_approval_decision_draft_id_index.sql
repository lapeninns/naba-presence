-- migrate:no-transaction

-- W4-08 follow-up (docs/audits/2026-10-14-full-stack-audit): deleting a draft
-- sets its approval decisions' draft_id to null with `update
-- approval_decision set draft_id = null where draft_id = $1`, and the only
-- index on approval_decision besides its primary key leads with review_id
-- (0138). Drafts go when their review does (retention's disconnectedReviews
-- purge), so each deleted draft scanned approval_decision.
--
-- Built concurrently, so writes to approval_decision carry on during the
-- build. That cannot run in a transaction, hence one index per file. A
-- failed concurrent build leaves an invalid index behind and records
-- nothing, so the re-run drops whatever is left before building again.

drop index concurrently if exists approval_decision_draft_id_idx;

create index concurrently if not exists approval_decision_draft_id_idx
  on approval_decision (draft_id);

insert into schema_migration(version) values ('0158_approval_decision_draft_id_index') on conflict (version) do nothing;
