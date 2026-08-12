begin;

-- Import-review queue: suggestion-only inbound sync for profile fields and
-- food menus. Google-side drift is staged as proposals that a human decides
-- on; nothing from Google mutates canonical data without a per-row decision.
create table presence_import_proposal (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  external_location_id uuid not null references external_location(id) on delete cascade,
  resource_type text not null check (resource_type in ('profile', 'food_menus')),
  -- profile rows: the field key; menu rows: deterministic label-based key.
  identity_key text not null,
  kind text not null check (kind in (
    'field_changed',
    'item_changed',
    'item_added_on_google',
    'item_missing_from_google',
    'section_added_on_google',
    'section_missing_from_google',
    'structure_changed'
  )),
  field_key text check (
    field_key in ('name', 'description', 'phone', 'address', 'mapsUrl', 'reviewUrl', 'website')
  ),
  google_path text,
  section_label text,
  item_label text,
  match_status text check (
    match_status in ('previous_identity', 'label_price', 'label_unique', 'unmatched')
  ),
  match_confidence numeric,
  canonical_value jsonb,
  google_value jsonb,
  suggested_patch jsonb not null,
  warnings jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'applied', 'ignored', 'failed', 'superseded')
  ),
  decision text check (decision in ('apply', 'ignore', 'delete_local', 'keep_local')),
  failure_code text,
  pinned_canonical_revision text not null,
  pinned_canonical_hash text not null,
  pinned_google_hash text not null,
  batch_id uuid not null,
  raised_via text not null check (raised_via in ('sweep', 'manual')),
  raised_by uuid references app_user(id) on delete set null,
  decided_by uuid references app_user(id) on delete set null,
  decided_at timestamptz,
  observed_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live row per identity. Includes 'processing' so a refresh can never
-- create a duplicate while a decision is in flight.
create unique index presence_import_proposal_live_key
  on presence_import_proposal (organisation_id, location_id, resource_type, identity_key)
  where status in ('pending', 'processing');

create index presence_import_proposal_queue_idx
  on presence_import_proposal (organisation_id, location_id, resource_type, status, created_at desc);
create index presence_import_proposal_pending_count_idx
  on presence_import_proposal (organisation_id, location_id)
  where status = 'pending';
create index presence_import_proposal_expiry_idx
  on presence_import_proposal (organisation_id, expires_at);

create trigger presence_import_proposal_updated_at before update on presence_import_proposal
  for each row execute function set_updated_at();

alter table presence_import_proposal enable row level security;
alter table presence_import_proposal force row level security;
create policy presence_import_proposal_isolation on presence_import_proposal
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);

grant select, insert, update, delete on presence_import_proposal to naba_app_runtime;

-- Google FoodMenu items carry no stable ids, so item identity is pinned as
-- label-anchored path pairs recorded at each reconcile point (publish, applied
-- import decision, observed in_sync). Pins are re-verified against labels
-- before they are trusted by the match ladder.
create table food_menu_item_identity (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  google_path text not null,
  local_path text not null,
  section_label text not null,
  item_label text not null,
  price_units text,
  price_nanos integer,
  last_reconciled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, location_id, google_path)
);

create index food_menu_item_identity_location_idx
  on food_menu_item_identity (organisation_id, location_id);

create trigger food_menu_item_identity_updated_at before update on food_menu_item_identity
  for each row execute function set_updated_at();

alter table food_menu_item_identity enable row level security;
alter table food_menu_item_identity force row level security;
create policy food_menu_item_identity_isolation on food_menu_item_identity
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);

grant select, insert, update, delete on food_menu_item_identity to naba_app_runtime;

-- Menu sync attempts learn the import direction, matching profile_sync_attempt.
alter table food_menus_sync_attempt
  add column operation text not null default 'publish_google'
    check (operation in ('publish_google', 'import_google')),
  add column direction text not null default 'to_google'
    check (direction in ('to_google', 'to_nabapresence')),
  add column remote_proposal_id uuid;

-- Profile sync attempts gain the import_google operation; direction gains the
-- standalone-presence spelling alongside the legacy value.
alter table profile_sync_attempt
  drop constraint profile_sync_attempt_operation_check;
alter table profile_sync_attempt
  add constraint profile_sync_attempt_operation_check check (
    operation in ('validate_google', 'publish_google', 'import_nabatable', 'import_google', 'reconcile')
  );
alter table profile_sync_attempt
  drop constraint profile_sync_attempt_direction_check;
alter table profile_sync_attempt
  add constraint profile_sync_attempt_direction_check check (
    direction in ('to_google', 'to_nabatable', 'to_nabapresence')
  );

insert into schema_migration (version) values ('0028_import_review')
on conflict (version) do nothing;

commit;
