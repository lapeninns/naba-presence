begin;

-- ---------------------------------------------------------------------------
-- Reviewer photo redaction and 13-month AI usage retention (plan P04-3,
-- ledger DATA-02).
--
-- ai_usage (0059) promised 13 months of retention but the runtime role was
-- never granted DELETE on it, so nothing could keep the promise. The purge
-- (lib/server/retention/purge.ts, dataset `aiUsage`) now deletes settled or
-- released rows older than 13 months whose credit period is over, behind
-- RETENTION_DELETES_ENABLED. ai_usage_created_idx serves its per-tenant scan;
-- the existing ai_usage_period_idx leads with period_start, not created_at.
--
-- The purge's review redaction now also clears reviewer_profile_photo_url.
-- 0099's review_unredacted_expiry_idx is a partial index on the narrower
-- predicate, which a row whose only remaining provider field is the photo
-- link does not satisfy, so the planner could not use it for the wider scan.
-- review_unredacted_expiry_v2_idx replaces it on the wider predicate. The
-- wider predicate is implied by the narrower one, so code still issuing
-- 0099's predicate can use it as well.
--
-- Plain `create index if not exists`: the migration runs in a transaction, so
-- CONCURRENTLY is unavailable. review is a fleet-wide table. Each build holds
-- a SHARE lock on its table until commit, which blocks every tenant's writes
-- (review ingest included) but not reads. The new review index is therefore
-- built before the old one is dropped: DROP INDEX takes an ACCESS EXCLUSIVE
-- lock, which also blocks reads, and holding it from the start would block
-- every review read for the whole build. Dropping last keeps that lock to the
-- moment between the drop and commit. Apply this migration in a low-traffic
-- window.
-- ---------------------------------------------------------------------------

grant delete on ai_usage to naba_app_runtime;

create index if not exists ai_usage_created_idx
  on ai_usage (organisation_id, created_at);

create index if not exists review_unredacted_expiry_v2_idx
  on review (organisation_id, raw_content_expires_at)
  where review_text is not null
    or reviewer_display_name is not null
    or reviewer_profile_photo_url is not null
    or raw_payload is not null;

-- Last statement before the version row: see the lock note above.
drop index if exists review_unredacted_expiry_idx;

insert into schema_migration (version)
values ('0100_ai_usage_retention')
on conflict (version) do nothing;

commit;
