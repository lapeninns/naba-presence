begin;

create table place_action_link (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null
    references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  external_location_id uuid not null
    references external_location(id) on delete cascade,
  google_link_name text not null,
  provider_type text not null,
  is_editable boolean not null,
  uri text not null,
  place_action_type text not null check (
    place_action_type in (
      'APPOINTMENT',
      'ONLINE_APPOINTMENT',
      'DINING_RESERVATION',
      'FOOD_ORDERING',
      'FOOD_DELIVERY',
      'FOOD_TAKEOUT',
      'SHOP_ONLINE'
    )
  ),
  is_preferred boolean not null default false,
  google_hash text not null,
  google_create_time timestamptz,
  google_update_time timestamptz,
  observed_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, google_link_name)
);

create table place_action_mutation (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null
    references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  external_location_id uuid not null
    references external_location(id) on delete cascade,
  place_action_link_id uuid references place_action_link(id) on delete set null,
  actor_user_id uuid not null references app_user(id) on delete restrict,
  operation text not null check (operation in ('create', 'update', 'delete')),
  status text not null check (
    status in ('started', 'succeeded', 'failed', 'ambiguous')
  ),
  idempotency_key text not null,
  expected_google_hash text,
  requested_payload jsonb,
  google_link_name text,
  google_response jsonb,
  last_error_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  expires_at timestamptz not null default now() + interval '180 days',
  created_at timestamptz not null default now(),
  unique (organisation_id, idempotency_key)
);

create index place_action_link_location_idx
  on place_action_link (organisation_id, location_id, deleted_at, place_action_type);
create index place_action_mutation_location_idx
  on place_action_mutation (organisation_id, location_id, created_at desc);
create index place_action_mutation_expiry_idx
  on place_action_mutation (organisation_id, expires_at);

create trigger place_action_link_updated_at
  before update on place_action_link
  for each row execute function set_updated_at();

alter table place_action_link enable row level security;
alter table place_action_link force row level security;
create policy place_action_link_isolation
  on place_action_link
  using (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  );

alter table place_action_mutation enable row level security;
alter table place_action_mutation force row level security;
create policy place_action_mutation_isolation
  on place_action_mutation
  using (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  );

grant select, insert, update, delete
  on place_action_link, place_action_mutation to naba_app_runtime;
grant select, insert, update, delete on place_action_link to naba_app_runtime;
grant select, insert, update, delete on place_action_mutation to naba_app_runtime;

insert into schema_migration (version)
values ('0018_place_action_links')
on conflict (version) do nothing;

commit;
