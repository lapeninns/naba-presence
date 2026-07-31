begin;

create table profile_field_state (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null
    references organisation(id) on delete cascade,
  venue_link_id uuid not null
    references nabatable_venue_link(id) on delete cascade,
  external_location_id uuid not null
    references external_location(id) on delete cascade,
  field_key text not null
    check (
      field_key in (
        'name',
        'description',
        'phone',
        'address',
        'mapsUrl',
        'reviewUrl',
        'website'
      )
    ),
  policy text not null
    check (policy in ('bidirectional', 'import_only', 'google_read_only')),
  status text not null
    check (status in ('in_sync', 'core_dirty', 'google_dirty', 'conflict')),
  canonical_value jsonb,
  google_value jsonb,
  canonical_hash text not null,
  google_hash text not null,
  baseline_canonical_hash text,
  baseline_google_hash text,
  projection_revision text not null,
  observed_at timestamptz not null default now(),
  snapshot_expires_at timestamptz not null default now() + interval '30 days',
  last_reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, venue_link_id, field_key)
);

create table profile_sync_attempt (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null
    references organisation(id) on delete cascade,
  venue_link_id uuid not null
    references nabatable_venue_link(id) on delete cascade,
  external_location_id uuid not null
    references external_location(id) on delete cascade,
  actor_user_id uuid references app_user(id) on delete set null,
  operation text not null
    check (
      operation in (
        'validate_google',
        'publish_google',
        'import_nabatable',
        'reconcile'
      )
    ),
  direction text not null
    check (direction in ('to_google', 'to_nabatable')),
  status text not null
    check (
      status in (
        'validating',
        'validated',
        'publishing',
        'importing',
        'succeeded',
        'failed',
        'ambiguous',
        'stale'
      )
    ),
  idempotency_key text not null,
  pinned_projection_revision text not null,
  pinned_canonical_hash text not null,
  pinned_google_hash text not null,
  selected_fields text[] not null default array[]::text[],
  update_mask text[] not null default array[]::text[],
  intended_payload jsonb not null,
  provider_http_status integer,
  provider_error_code text,
  provider_response_hash text,
  remote_proposal_id uuid,
  validated_at timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  expires_at timestamptz not null default now() + interval '365 days',
  created_at timestamptz not null default now(),
  unique (organisation_id, idempotency_key)
);

create index profile_field_state_location_status_idx
  on profile_field_state (
    organisation_id,
    external_location_id,
    status,
    updated_at desc
  );

create index profile_field_state_snapshot_expiry_idx
  on profile_field_state (snapshot_expires_at)
  where snapshot_expires_at is not null;

create index profile_sync_attempt_location_idx
  on profile_sync_attempt (
    organisation_id,
    external_location_id,
    created_at desc
  );

create index profile_sync_attempt_expiry_idx
  on profile_sync_attempt (expires_at)
  where expires_at is not null;

create trigger profile_field_state_updated_at
  before update on profile_field_state
  for each row execute function set_updated_at();

alter table profile_field_state enable row level security;
alter table profile_field_state force row level security;
create policy profile_field_state_isolation on profile_field_state
  using (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  );

alter table profile_sync_attempt enable row level security;
alter table profile_sync_attempt force row level security;
create policy profile_sync_attempt_isolation on profile_sync_attempt
  using (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  );

grant select, insert, update, delete
  on profile_field_state to naba_app_runtime;
grant select, insert, update, delete
  on profile_sync_attempt to naba_app_runtime;

insert into schema_migration (version)
values ('0016_profile_management')
on conflict (version) do nothing;

commit;
