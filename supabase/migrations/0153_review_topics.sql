begin;

-- ---------------------------------------------------------------------------
-- S3: what guests talk about (review topics and trends).
--
-- review_topic                  one row per (review, topic) the classifier
--                               found, with the sentiment of that mention.
--                               No review text: the labels outlive the text,
--                               which retention redacts after 30 days.
--
-- review_topic_classification   one row per review the classifier has
--                               claimed or answered. text_hash is md5 of the
--                               review text it classified, so an edited text
--                               no longer matches and the review is claimed
--                               again. claim_id/lease_expires_at hold a claim
--                               while one job run calls the model; attempts
--                               counts answers that were unusable, and stops
--                               the retries at the job's limit.
--
-- review_topic_due_organisations  the cross-tenant enumeration the job tick
--                               starts from (SECURITY DEFINER, like
--                               claim_due_privacy_withdrawals in 0101).
--
-- ai_usage.kind gains 'classify': a classification call costs no draft
-- credit but holds and records its tokens against the backstop, as a
-- verification call does (lib/server/ai-usage.ts).
-- ---------------------------------------------------------------------------

create table review_topic_classification (
  organisation_id uuid not null references organisation(id) on delete cascade,
  review_id uuid primary key references review(id) on delete cascade,
  status text not null check (status in ('pending', 'classified', 'failed')),
  text_hash text not null,
  attempts smallint not null default 0 check (attempts >= 0),
  claim_id uuid,
  lease_expires_at timestamptz,
  model text,
  review_update_time timestamptz not null,
  classified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index review_topic_classification_org_idx
  on review_topic_classification (organisation_id, status);

create index review_topic_classification_claim_idx
  on review_topic_classification (claim_id)
  where claim_id is not null;

alter table review_topic_classification enable row level security;
alter table review_topic_classification force row level security;
create policy tenant_isolation on review_topic_classification
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );
grant select, insert, update, delete on review_topic_classification
  to naba_app_runtime;

create table review_topic (
  organisation_id uuid not null references organisation(id) on delete cascade,
  review_id uuid not null references review(id) on delete cascade,
  topic text not null check (
    topic in (
      'food_quality',
      'drinks',
      'service',
      'wait_time',
      'price_value',
      'atmosphere',
      'cleanliness',
      'booking',
      'sunday_roast',
      'events_sport',
      'dogs_family',
      'accessibility',
      'parking'
    )
  ),
  sentiment text not null
    check (sentiment in ('positive', 'neutral', 'negative')),
  model text not null,
  classified_at timestamptz not null,
  review_update_time timestamptz not null,
  primary key (review_id, topic)
);

create index review_topic_org_topic_idx
  on review_topic (organisation_id, topic, sentiment);

alter table review_topic enable row level security;
alter table review_topic force row level security;
create policy tenant_isolation on review_topic
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );
grant select, insert, update, delete on review_topic to naba_app_runtime;

-- Organisations with the review_topics feature on (organisation_feature,
-- 0090: new work ships dark) and at least one review waiting for the
-- classifier: text
-- held, live, not erased, and no current answer (none yet, an edited text,
-- or an unusable answer below the attempt limit whose claim has lapsed).
-- Random order so an organisation the job has to skip (read-only billing,
-- the token backstop) cannot starve the others.
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

alter table ai_usage drop constraint if exists ai_usage_kind_check;
alter table ai_usage
  add constraint ai_usage_kind_check
  check (kind in ('draft', 'verify', 'classify')) not valid;
alter table ai_usage validate constraint ai_usage_kind_check;

insert into schema_migration (version)
values ('0153_review_topics') on conflict (version) do nothing;
commit;
