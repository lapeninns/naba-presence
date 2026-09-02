begin;

-- ---------------------------------------------------------------------------
-- Review erasure durability, resumable sweeps, terminal checkpoints.
--
-- `review.erased_at` is the marker `upsertGoogleReview` keys its guard on.
-- It has to be an explicit marker and not "the content is null": the
-- retention cron nulls review_text / reviewer_display_name / raw_payload for
-- every expired row, and freezing those would stop a live review ever being
-- refreshed from Google again. Only a fulfilled erasure sets this column.
--
-- `review.last_seen_at` and `sync_checkpoint.sweep_started_at` move the
-- sweep's seen-set out of process memory. Without them a sweep can only
-- tombstone what one HTTP request enumerated, so it had to restart at page
-- one on every claim and could never finish a location the job runner's page
-- budget cannot cover in one go.
--
-- 'dead' gives sync_checkpoint the terminal state it never had, and
-- `consecutive_failure_count` the counter that decides when to use it
-- (`attempt_count` also increments on healthy runs, so it cannot). Every
-- claim predicate is an allowlist -- `status in ('pending', 'failed')` in
-- claim_due_jobs, `status = 'running'` in reclaim_expired_jobs -- so the new
-- status is excluded from all of them without rewriting either function
-- body, which other in-flight work also replaces.
-- ---------------------------------------------------------------------------

alter table review
  add column if not exists erased_at timestamptz,
  add column if not exists last_seen_at timestamptz;

alter table sync_checkpoint
  add column if not exists sweep_started_at timestamptz,
  add column if not exists consecutive_failure_count integer not null default 0;

alter table sync_checkpoint
  drop constraint if exists sync_checkpoint_status_check;

alter table sync_checkpoint
  add constraint sync_checkpoint_status_check
  check (
    status in (
      'pending',
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'dead'
    )
  );

insert into schema_migration (version)
values ('0030_review_erasure_and_checkpoints')
on conflict (version) do nothing;

commit;
