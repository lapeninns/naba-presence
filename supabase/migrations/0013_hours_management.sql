begin;

create table nabatable_venue_link (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null
    references organisation(id) on delete cascade,
  location_id uuid not null
    references location(id) on delete cascade,
  external_location_id uuid not null
    references external_location(id) on delete cascade,
  nabatable_restaurant_id uuid not null,
  nabatable_restaurant_name text not null,
  mapping_status text not null default 'active'
    check (mapping_status in ('active', 'paused')),
  projection_revision text,
  projection_etag text,
  baseline_canonical_hash text,
  baseline_google_hash text,
  last_canonical_hours jsonb,
  last_google_hours jsonb,
  snapshot_observed_at timestamptz,
  snapshot_expires_at timestamptz,
  last_reconciled_at timestamptz,
  created_by uuid references app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, location_id),
  unique (organisation_id, external_location_id),
  unique (organisation_id, nabatable_restaurant_id)
);

create table hours_sync_attempt (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null
    references organisation(id) on delete cascade,
  venue_link_id uuid not null
    references nabatable_venue_link(id) on delete cascade,
  external_location_id uuid not null
    references external_location(id) on delete cascade,
  actor_user_id uuid references app_user(id) on delete set null,
  operation text not null default 'publish'
    check (operation in ('validate', 'publish', 'reconcile')),
  status text not null
    check (
      status in (
        'validating',
        'validated',
        'publishing',
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
  update_mask text[] not null default array[]::text[],
  intended_payload jsonb not null,
  warnings jsonb not null default '[]'::jsonb,
  provider_http_status integer,
  provider_error_code text,
  provider_response_hash text,
  validated_at timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  expires_at timestamptz not null default now() + interval '365 days',
  created_at timestamptz not null default now(),
  unique (organisation_id, idempotency_key)
);

create index hours_sync_attempt_location_idx
  on hours_sync_attempt (
    organisation_id,
    external_location_id,
    created_at desc
  );

create trigger nabatable_venue_link_updated_at
  before update on nabatable_venue_link
  for each row execute function set_updated_at();

alter table nabatable_venue_link enable row level security;
alter table nabatable_venue_link force row level security;
create policy nabatable_venue_link_isolation on nabatable_venue_link
  using (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  );

alter table hours_sync_attempt enable row level security;
alter table hours_sync_attempt force row level security;
create policy hours_sync_attempt_isolation on hours_sync_attempt
  using (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  );

grant select, insert, update, delete
  on nabatable_venue_link to naba_app_runtime;
grant select, insert, update, delete
  on hours_sync_attempt to naba_app_runtime;

insert into schema_migration (version)
values ('0013_hours_management')
on conflict (version) do nothing;

commit;
