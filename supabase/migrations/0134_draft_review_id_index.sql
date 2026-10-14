-- migrate:no-transaction

-- W4-08 (docs/audits/2026-10-14-full-stack-audit): deleting a review cascades
-- to its drafts with `delete from draft where review_id = $1`, which runs
-- without RLS and so has no organisation_id to lead draft_review_idx with.
-- PostgreSQL 17 has no skip scan, so each deleted review scanned draft.
--
-- Built concurrently, so writes to draft carry on during the
-- build. That cannot run in a transaction, hence one index per file. A
-- failed concurrent build leaves an invalid index behind and records
-- nothing, so the re-run drops whatever is left before building again.

drop index concurrently if exists draft_review_id_idx;

create index concurrently draft_review_id_idx
  on draft (review_id);

insert into schema_migration(version) values ('0134_draft_review_id_index') on conflict (version) do nothing;
