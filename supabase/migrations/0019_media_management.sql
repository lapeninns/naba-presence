begin;

create table gbp_media_item (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  external_location_id uuid not null references external_location(id) on delete cascade,
  google_media_name text not null,
  ownership text not null check (ownership in ('merchant', 'customer')),
  media_format text not null check (media_format in ('PHOTO', 'VIDEO')),
  category text,
  source_url text,
  google_url text,
  thumbnail_url text,
  description text,
  attribution jsonb,
  dimensions jsonb,
  insights jsonb,
  google_hash text not null,
  google_create_time timestamptz,
  observed_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, google_media_name)
);

create table gbp_media_mutation (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  media_item_id uuid references gbp_media_item(id) on delete set null,
  actor_user_id uuid not null references app_user(id) on delete restrict,
  operation text not null check (operation in ('create', 'update', 'delete')),
  status text not null check (status in ('started', 'succeeded', 'failed', 'ambiguous')),
  idempotency_key text not null,
  expected_google_hash text,
  requested_payload jsonb,
  google_response jsonb,
  last_error_code text,
  finished_at timestamptz,
  expires_at timestamptz not null default now() + interval '180 days',
  created_at timestamptz not null default now(),
  unique (organisation_id, idempotency_key)
);

create index gbp_media_location_idx
  on gbp_media_item (organisation_id, location_id, ownership, deleted_at, created_at desc);
create index gbp_media_mutation_idx
  on gbp_media_mutation (organisation_id, location_id, created_at desc);
create index gbp_media_mutation_expiry_idx
  on gbp_media_mutation (organisation_id, expires_at);

create trigger gbp_media_item_updated_at before update on gbp_media_item
  for each row execute function set_updated_at();

alter table gbp_media_item enable row level security;
alter table gbp_media_item force row level security;
create policy gbp_media_item_isolation on gbp_media_item
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);

alter table gbp_media_mutation enable row level security;
alter table gbp_media_mutation force row level security;
create policy gbp_media_mutation_isolation on gbp_media_mutation
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);

grant select, insert, update, delete on gbp_media_item, gbp_media_mutation to naba_app_runtime;
grant select, insert, update, delete on gbp_media_item to naba_app_runtime;
grant select, insert, update, delete on gbp_media_mutation to naba_app_runtime;

insert into schema_migration (version) values ('0019_media_management')
on conflict (version) do nothing;

commit;
