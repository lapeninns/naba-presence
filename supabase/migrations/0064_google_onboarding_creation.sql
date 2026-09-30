begin;

create table google_onboarding_creation (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  draft_id uuid not null unique references google_onboarding_draft(id) on delete cascade,
  review_id uuid not null references google_onboarding_review(id) on delete cascade,
  review_hash text not null,
  actor_user_id uuid not null references app_user(id) on delete restrict,
  execution_state text not null default 'pending' check (execution_state in ('pending', 'accepted', 'rejected', 'unknown')),
  confirmation_state text not null default 'pending' check (confirmation_state in ('pending', 'confirmed', 'unresolved')),
  link_state text not null default 'pending' check (link_state in ('pending', 'linked', 'failed')),
  provider_resource_name text check (provider_resource_name ~ '^locations/[^/[:space:]]+$'),
  provider_response jsonb,
  confirmation_response jsonb,
  confirmation_observed_at timestamptz,
  location_id uuid references location(id) on delete set null,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index google_onboarding_creation_org_idx on google_onboarding_creation (organisation_id, created_at desc, id);
alter table google_onboarding_creation enable row level security;
alter table google_onboarding_creation force row level security;
create policy google_onboarding_creation_isolation on google_onboarding_creation
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, delete on google_onboarding_creation to naba_app_runtime;
grant update (execution_state, confirmation_state, link_state, provider_resource_name, provider_response, confirmation_response, confirmation_observed_at, location_id, error_code, updated_at) on google_onboarding_creation to naba_app_runtime;

insert into schema_migration (version) values ('0064_google_onboarding_creation') on conflict (version) do nothing;
commit;
