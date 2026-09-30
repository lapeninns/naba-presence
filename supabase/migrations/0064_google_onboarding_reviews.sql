begin;

create table google_onboarding_review (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  draft_id uuid not null references google_onboarding_draft(id) on delete cascade,
  revision integer not null check (revision > 0),
  match_request_id uuid not null,
  frozen jsonb not null check (jsonb_typeof(frozen) = 'object'),
  review_hash text not null,
  requested_by uuid not null references app_user(id) on delete restrict,
  approved_by uuid references app_user(id) on delete restrict,
  approved_at timestamptz,
  require_two_person_approval boolean not null,
  validation_request_id uuid not null,
  validation_response jsonb not null check (jsonb_typeof(validation_response) = 'object'),
  validated_at timestamptz not null default now(),
  approval_expires_at timestamptz not null default now() + interval '24 hours',
  check ((approved_by is null) = (approved_at is null))
);

create index google_onboarding_review_draft_idx on google_onboarding_review (organisation_id, draft_id, validated_at desc, id);
alter table google_onboarding_review enable row level security;
alter table google_onboarding_review force row level security;
create policy google_onboarding_review_isolation on google_onboarding_review
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, delete on google_onboarding_review to naba_app_runtime;
grant update (approved_by, approved_at) on google_onboarding_review to naba_app_runtime;

insert into schema_migration (version) values ('0064_google_onboarding_reviews') on conflict (version) do nothing;
commit;
