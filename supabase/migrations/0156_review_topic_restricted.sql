begin;

-- ---------------------------------------------------------------------------
-- S3: a restricted review is never classified.
--
-- A fulfilled restriction request (app/api/privacy/requests) sets
-- review.restricted_at and keeps the review text, but its processing stops:
-- drafting already refuses it (lib/server/review-drafts.ts assertDraftable).
-- review_topic_due_organisations (0153) counted such a review as waiting, so
-- the job tick would visit its organisation and the claim would send its text
-- to the AI provider. The job's claim (lib/server/review-topics-job.ts
-- pendingPredicate) now skips restricted reviews; this redefines the
-- enumeration to match, same signature, owner and grants.
-- ---------------------------------------------------------------------------

create or replace function review_topic_due_organisations(
  p_limit integer,
  p_max_attempts integer
)
returns table (organisation_id uuid)
language sql
volatile
security definer
set search_path = public
as $$
  select due.organisation_id
  from (
    select distinct r.organisation_id
    from review r
    join organisation_feature f
      on f.organisation_id = r.organisation_id
      and f.feature = 'review_topics'
      and f.enabled
    left join review_topic_classification c on c.review_id = r.id
    where r.review_text is not null
      and btrim(r.review_text) <> ''
      and r.provider_deleted_at is null
      and r.erased_at is null
      and r.restricted_at is null
      and (c.lease_expires_at is null or c.lease_expires_at < now())
      and (
        c.review_id is null
        or c.text_hash <> md5(r.review_text)
        or (c.status <> 'classified' and c.attempts < p_max_attempts)
      )
  ) due
  order by random()
  limit p_limit
$$;

revoke all on function review_topic_due_organisations(integer, integer)
  from public;
grant execute on function review_topic_due_organisations(integer, integer)
  to naba_app_runtime;

insert into schema_migration (version)
values ('0156_review_topic_restricted') on conflict (version) do nothing;

commit;
