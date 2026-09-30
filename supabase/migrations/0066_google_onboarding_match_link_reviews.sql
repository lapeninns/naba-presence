begin;

alter table google_onboarding_draft add constraint google_onboarding_draft_org_id_unique unique (organisation_id, id);

-- Local mapping reviews are not provider creation or validation attempts.
-- Retention follows the parent draft's 180-day expiry and cascade purge.
create table google_onboarding_match_link_review (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  draft_id uuid not null,
  match_request_id uuid not null,
  frozen jsonb not null check (jsonb_typeof(frozen) = 'object'),
  review_hash text not null check (length(review_hash) = 64),
  requested_by uuid not null references app_user(id) on delete restrict,
  approved_by uuid references app_user(id) on delete restrict,
  approved_at timestamptz,
  require_two_person_approval boolean not null,
  observed_at timestamptz not null default now(),
  approval_expires_at timestamptz not null default now() + interval '24 hours',
  foreign key (organisation_id, draft_id) references google_onboarding_draft(organisation_id, id) on delete cascade,
  check ((approved_by is null) = (approved_at is null))
);
create index google_onboarding_match_link_review_draft_idx on google_onboarding_match_link_review (organisation_id, draft_id, observed_at desc, id);
alter table google_onboarding_match_link_review enable row level security;
alter table google_onboarding_match_link_review force row level security;
create policy google_onboarding_match_link_review_isolation on google_onboarding_match_link_review
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, delete on google_onboarding_match_link_review to naba_app_runtime;
grant update (approved_by, approved_at) on google_onboarding_match_link_review to naba_app_runtime;

insert into schema_migration (version) values ('0066_google_onboarding_match_link_reviews') on conflict (version) do nothing;
commit;
