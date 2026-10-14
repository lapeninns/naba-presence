-- migrate:no-transaction

-- W4-04 (docs/audits/2026-10-14-full-stack-audit): audit_log is read by
-- subject. The review timeline asks for one review's newest rows, and the
-- posts list for each post's latest edit, but neither existing index leads
-- with the subject (the unique key has request_id second). The key serves
-- the timeline's ordered limit; action is included so the posts list's
-- latest-edit probe can stay index-only.
--
-- Built concurrently, so writes to audit_log carry on during the
-- build. That cannot run in a transaction, hence one index per file. A
-- failed concurrent build leaves an invalid index behind and records
-- nothing, so the re-run drops whatever is left before building again.

drop index concurrently if exists audit_log_subject_idx;

create index concurrently audit_log_subject_idx
  on audit_log (organisation_id, subject_type, subject_id, created_at desc)
  include (action);

insert into schema_migration(version) values ('0134_audit_log_subject_index') on conflict (version) do nothing;
