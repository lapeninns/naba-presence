begin;

-- ---------------------------------------------------------------------------
-- Bounded, resumable retention purges (plan P04-2, ledger DATA-01).
--
-- Each organisation used to be retained in ONE tenant transaction of ~30
-- unbounded statements: a tenant with a backlog could outrun the time budget
-- or maxDuration, roll the whole purge back, and fail identically every day.
-- The purge now runs in rounds (lib/server/retention/purge.ts): each round is
-- one transaction in which every dataset still behind changes at most
-- RETENTION_BATCH_ROWS rows, and a run the budget stops part-way leaves the
-- organisation pending in its cycle (0097) for the next fire to resume.
--
-- retention_cycle_org
--   counts    rows each dataset changed for the organisation in this cycle,
--             summed after every committed round, so the completion audit
--             reports its totals across fires and a run that later fails or
--             is killed still leaves what it committed on record
--   resumes   runs the budget stopped with work still due; those are handed
--             back instead of counted as attempts, up to a cap
--
-- Indexes for the scans each round repeats:
--   review                still-unredacted expired rows only, so the scan no
--                         longer walks every review it has already redacted
--   review_media_item     by review, for the expiry join and review cascades
--   hours_sync_attempt    expiry, as the other attempt tables already have
--
-- The review index's predicate is the purge's redaction predicate; a purge
-- that widens it (P04-3 adds reviewer_profile_photo_url) needs a new partial
-- index matching the wider predicate, or the planner cannot use this one.
--
-- Plain `create index if not exists`: the migration runs in a transaction, so
-- CONCURRENTLY is unavailable. review, review_media_item and
-- hours_sync_attempt are fleet-wide tables, and each build holds a SHARE lock
-- that blocks every tenant's writes to that table (review ingest included)
-- until it finishes. Apply this migration in a low-traffic window.
-- ---------------------------------------------------------------------------

alter table retention_cycle_org
  add column counts jsonb not null default '{}'::jsonb,
  add column resumes integer not null default 0 check (resumes >= 0);

create index if not exists review_unredacted_expiry_idx
  on review (organisation_id, raw_content_expires_at)
  where review_text is not null
    or reviewer_display_name is not null
    or raw_payload is not null;

create index if not exists review_media_item_review_idx
  on review_media_item (review_id);

create index if not exists hours_sync_attempt_expiry_idx
  on hours_sync_attempt (organisation_id, expires_at);

insert into schema_migration (version)
values ('0099_retention_batches')
on conflict (version) do nothing;

commit;
