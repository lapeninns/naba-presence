-- migrate:no-transaction

-- W4-08 (docs/audits/2026-10-14-full-stack-audit): deleting a review deletes
-- its drafts, and each deleted draft runs `update review_reply set
-- pending_draft_id = null where pending_draft_id = $1` (0039, on delete set
-- null) without RLS. review_reply had no index on pending_draft_id, so every
-- deleted draft scanned the table. Partial, because only a reply parked for
-- approval names a draft.
--
-- Built concurrently, so writes to review_reply carry on during the
-- build. That cannot run in a transaction, hence one index per file. A
-- failed concurrent build leaves an invalid index behind and records
-- nothing, so the re-run drops whatever is left before building again.

drop index concurrently if exists review_reply_pending_draft_idx;

create index concurrently review_reply_pending_draft_idx
  on review_reply (pending_draft_id)
  where pending_draft_id is not null;

insert into schema_migration(version) values ('0137_review_reply_pending_draft_index') on conflict (version) do nothing;
