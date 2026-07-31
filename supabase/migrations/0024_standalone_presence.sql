begin;

create table presence_canonical_resource (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  resource_type text not null
    check (resource_type in ('profile', 'hours', 'food_menus')),
  revision bigint not null default 1 check (revision > 0),
  payload jsonb not null,
  baseline_canonical_hash text,
  baseline_google_hash text,
  last_reconciled_at timestamptz,
  created_by uuid references app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, location_id, resource_type)
);

create index presence_canonical_resource_location_idx
  on presence_canonical_resource (organisation_id, location_id, resource_type);

create trigger presence_canonical_resource_updated_at
  before update on presence_canonical_resource
  for each row execute function set_updated_at();

alter table presence_canonical_resource enable row level security;
alter table presence_canonical_resource force row level security;
create policy presence_canonical_resource_isolation
  on presence_canonical_resource
  using (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  );

grant select, insert, update, delete
  on presence_canonical_resource to naba_app_runtime;

-- Preserve any canonical snapshots created by the transitional integration.
insert into presence_canonical_resource (
  organisation_id,
  location_id,
  resource_type,
  revision,
  payload,
  baseline_canonical_hash,
  baseline_google_hash,
  last_reconciled_at,
  created_by
)
select
  organisation_id,
  location_id,
  'hours',
  1,
  last_canonical_hours,
  baseline_canonical_hash,
  baseline_google_hash,
  last_reconciled_at,
  created_by
from nabatable_venue_link
where last_canonical_hours is not null
on conflict (organisation_id, location_id, resource_type) do nothing;

insert into presence_canonical_resource (
  organisation_id,
  location_id,
  resource_type,
  revision,
  payload
)
select
  pfs.organisation_id,
  ll.location_id,
  'profile',
  1,
  jsonb_object_agg(pfs.field_key, pfs.canonical_value -> 'value')
from profile_field_state pfs
join location_link ll
  on ll.external_location_id = pfs.external_location_id
 and ll.is_active = true
group by pfs.organisation_id, ll.location_id
on conflict (organisation_id, location_id, resource_type) do nothing;

insert into presence_canonical_resource (
  organisation_id,
  location_id,
  resource_type,
  revision,
  payload
)
select
  organisation_id,
  location_id,
  'food_menus',
  1,
  canonical_payload
from food_menus_state
on conflict (organisation_id, location_id, resource_type) do nothing;

alter table hours_sync_attempt
  add column location_id uuid references location(id) on delete cascade;
update hours_sync_attempt hsa
set location_id = ll.location_id
from location_link ll
where ll.external_location_id = hsa.external_location_id
  and ll.is_active = true;
alter table hours_sync_attempt
  drop constraint hours_sync_attempt_venue_link_id_fkey,
  drop column venue_link_id;
alter table hours_sync_attempt
  rename column pinned_projection_revision to pinned_canonical_revision;
create index hours_sync_attempt_internal_location_idx
  on hours_sync_attempt (organisation_id, location_id, created_at desc);

alter table profile_field_state
  add column location_id uuid references location(id) on delete cascade;
update profile_field_state pfs
set location_id = ll.location_id
from location_link ll
where ll.external_location_id = pfs.external_location_id
  and ll.is_active = true;
alter table profile_field_state
  drop constraint profile_field_state_venue_link_id_fkey,
  drop constraint profile_field_state_organisation_id_venue_link_id_field_key_key,
  drop column venue_link_id;
alter table profile_field_state
  rename column projection_revision to canonical_revision;
create unique index profile_field_state_location_field_key
  on profile_field_state (organisation_id, location_id, field_key);

alter table profile_sync_attempt
  add column location_id uuid references location(id) on delete cascade;
update profile_sync_attempt psa
set location_id = ll.location_id
from location_link ll
where ll.external_location_id = psa.external_location_id
  and ll.is_active = true;
alter table profile_sync_attempt
  drop constraint profile_sync_attempt_venue_link_id_fkey,
  drop column venue_link_id;
alter table profile_sync_attempt
  rename column pinned_projection_revision to pinned_canonical_revision;

alter table food_menus_state
  drop constraint food_menus_state_venue_link_id_fkey,
  drop column venue_link_id;
alter table food_menus_state
  rename column projection_revision to canonical_revision;

alter table food_menus_sync_attempt
  drop constraint food_menus_sync_attempt_venue_link_id_fkey,
  drop column venue_link_id;
alter table food_menus_sync_attempt
  rename column expected_projection_revision to expected_canonical_revision;

drop table nabatable_venue_link;

insert into schema_migration (version)
values ('0024_standalone_presence')
on conflict (version) do nothing;

commit;
