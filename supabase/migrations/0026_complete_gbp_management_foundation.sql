begin;

alter table google_connection
  add column notification_types text[] not null
    default array['NEW_REVIEW', 'UPDATED_REVIEW']::text[];

alter table presence_canonical_resource
  drop constraint if exists presence_canonical_resource_resource_type_check;
alter table presence_canonical_resource
  add constraint presence_canonical_resource_resource_type_check
  check (resource_type in (
    'profile',
    'hours',
    'food_menus',
    'business_info',
    'attributes',
    'lodging',
    'business_calls',
    'healthcare'
  ));

create table gbp_resource_snapshot (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid references location(id) on delete cascade,
  google_account_id uuid references google_account(id) on delete cascade,
  resource_type text not null check (resource_type in (
    'business_info', 'attributes', 'google_update', 'verification',
    'account_admin', 'location_admin', 'invitation', 'lodging',
    'business_calls', 'business_call_insights', 'healthcare_services',
    'healthcare_provider_attributes', 'insurance_networks'
  )),
  resource_name text not null,
  payload jsonb not null,
  google_hash text not null,
  observed_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, resource_type, resource_name)
);

create table gbp_management_mutation (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid references location(id) on delete set null,
  google_account_id uuid references google_account(id) on delete set null,
  actor_user_id uuid not null references app_user(id) on delete restrict,
  resource_type text not null check (resource_type in (
    'business_info', 'attributes', 'location_lifecycle', 'verification',
    'account_admin', 'location_admin', 'invitation', 'lodging',
    'business_calls', 'healthcare_services',
    'healthcare_provider_attributes', 'notifications'
  )),
  operation text not null,
  target_resource_name text,
  status text not null check (status in (
    'started', 'validated', 'succeeded', 'failed', 'ambiguous'
  )),
  idempotency_key text not null,
  expected_google_hash text,
  update_mask text[] not null default '{}',
  requested_payload jsonb,
  google_response jsonb,
  last_error_code text,
  validated_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz not null default now() + interval '180 days',
  created_at timestamptz not null default now(),
  unique (organisation_id, idempotency_key)
);

create index gbp_resource_snapshot_location_idx
  on gbp_resource_snapshot (
    organisation_id, location_id, resource_type, observed_at desc
  );
create index gbp_resource_snapshot_account_idx
  on gbp_resource_snapshot (
    organisation_id, google_account_id, resource_type, observed_at desc
  );
create index gbp_resource_snapshot_expiry_idx
  on gbp_resource_snapshot (organisation_id, expires_at);
create index gbp_management_mutation_location_idx
  on gbp_management_mutation (
    organisation_id, location_id, resource_type, created_at desc
  );
create index gbp_management_mutation_account_idx
  on gbp_management_mutation (
    organisation_id, google_account_id, resource_type, created_at desc
  );
create index gbp_management_mutation_expiry_idx
  on gbp_management_mutation (organisation_id, expires_at);

create trigger gbp_resource_snapshot_updated_at
  before update on gbp_resource_snapshot
  for each row execute function set_updated_at();

alter table gbp_resource_snapshot enable row level security;
alter table gbp_resource_snapshot force row level security;
create policy gbp_resource_snapshot_isolation on gbp_resource_snapshot
  using (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  );

alter table gbp_management_mutation enable row level security;
alter table gbp_management_mutation force row level security;
create policy gbp_management_mutation_isolation on gbp_management_mutation
  using (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  );

grant select, insert, update, delete
  on gbp_resource_snapshot to naba_app_runtime;
grant select, insert, update, delete
  on gbp_management_mutation to naba_app_runtime;

insert into schema_migration (version)
values ('0026_complete_gbp_management_foundation')
on conflict (version) do nothing;

commit;
