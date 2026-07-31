begin;

create table food_menus_state (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  external_location_id uuid not null references external_location(id) on delete cascade,
  venue_link_id uuid not null references nabatable_venue_link(id) on delete cascade,
  eligible boolean not null,
  projection_revision text not null,
  canonical_hash text not null,
  google_hash text not null,
  canonical_payload jsonb not null,
  google_payload jsonb not null,
  observed_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, location_id)
);

create table food_menus_sync_attempt (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  external_location_id uuid not null references external_location(id) on delete cascade,
  venue_link_id uuid not null references nabatable_venue_link(id) on delete cascade,
  actor_user_id uuid not null references app_user(id) on delete restrict,
  status text not null check (status in ('validating', 'publishing', 'succeeded', 'failed', 'ambiguous')),
  idempotency_key text not null,
  expected_projection_revision text not null,
  expected_canonical_hash text not null,
  expected_google_hash text not null,
  intended_payload jsonb not null,
  provider_response jsonb,
  last_error_code text,
  finished_at timestamptz,
  expires_at timestamptz not null default now() + interval '180 days',
  created_at timestamptz not null default now(),
  unique (organisation_id, idempotency_key)
);

create index food_menus_state_location_idx on food_menus_state (organisation_id, location_id);
create index food_menus_state_expiry_idx on food_menus_state (organisation_id, expires_at);
create index food_menus_attempt_location_idx on food_menus_sync_attempt (organisation_id, location_id, created_at desc);
create index food_menus_attempt_expiry_idx on food_menus_sync_attempt (organisation_id, expires_at);

create trigger food_menus_state_updated_at before update on food_menus_state
  for each row execute function set_updated_at();

alter table food_menus_state enable row level security;
alter table food_menus_state force row level security;
create policy food_menus_state_isolation on food_menus_state
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);

alter table food_menus_sync_attempt enable row level security;
alter table food_menus_sync_attempt force row level security;
create policy food_menus_sync_attempt_isolation on food_menus_sync_attempt
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);

grant select, insert, update, delete on food_menus_state, food_menus_sync_attempt to naba_app_runtime;
grant select, insert, update, delete on food_menus_state to naba_app_runtime;
grant select, insert, update, delete on food_menus_sync_attempt to naba_app_runtime;

insert into schema_migration (version) values ('0020_food_menus_management')
on conflict (version) do nothing;

commit;
