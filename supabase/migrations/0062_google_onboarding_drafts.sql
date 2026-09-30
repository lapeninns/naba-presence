begin;

create table google_onboarding_draft (
  id uuid primary key,
  organisation_id uuid not null references organisation(id) on delete cascade,
  google_account_id uuid not null references google_account(id) on delete cascade,
  account_name text not null check (account_name ~ '^accounts/[^/[:space:]]+$'),
  connection_id uuid not null references google_connection(id) on delete cascade,
  client_id uuid references client(id) on delete cascade,
  requested_by uuid not null references app_user(id) on delete restrict,
  provider_request_id uuid not null default gen_random_uuid() unique,
  revision integer not null default 1 check (revision > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  payload_hash text not null,
  match_result jsonb check (match_result is null or jsonb_typeof(match_result) = 'object'),
  match_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '180 days'
);

create index google_onboarding_draft_account_idx on google_onboarding_draft (organisation_id, google_account_id, created_at desc, id);
create index google_onboarding_draft_expiry_idx on google_onboarding_draft (organisation_id, expires_at);
alter table google_onboarding_draft enable row level security;
alter table google_onboarding_draft force row level security;
create policy google_onboarding_draft_isolation on google_onboarding_draft
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, delete on google_onboarding_draft to naba_app_runtime;
grant update (revision, payload, payload_hash, match_result, match_request_id, updated_at) on google_onboarding_draft to naba_app_runtime;

insert into schema_migration (version) values ('0062_google_onboarding_drafts') on conflict (version) do nothing;
commit;
