begin;

-- P09-R7: private photo assets and the bulk photos family.
--
-- media_asset is one photo the organisation owns, kept in a private storage
-- bucket the app reaches with a server-only key (lib/server/storage):
--
--   staging   a signed upload URL was handed out for staging_key; the bytes
--             there are unchecked and are never sent anywhere.
--   ready     finalise read the staged bytes, checked their magic bytes,
--             size, pixel dimensions and SHA-256 against what the uploader
--             declared, and wrote exactly those bytes once to final_key.
--             From then on the row's content columns never change (trigger
--             below), so every listing gets the same bytes.
--   rejected  the staged bytes failed a check (rejection_code).
--   purged    never finalised; the retention cron deleted the staged object
--             after 24 hours (staging_expires_at).
--
-- staging_purged_at records that the staged object is gone (finalise removes
-- it; the retention cron catches any it could not).
--
-- media_asset_publication records one asset on one listing: the bulk child
-- that sent it, its media attempt (gbp_media_mutation) and the Google media
-- name it got there. At most one pending or published row per (asset,
-- listing); a failed one leaves room for a later batch, and a published one
-- Google no longer lists (deleted there since) is marked `removed` when a
-- later batch adds the asset again.
--
-- Batches and children may carry the new `photos` family under the key
-- `media`.

create table media_asset (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  created_by uuid references app_user(id) on delete set null,
  status text not null default 'staging'
    check (status in ('staging', 'ready', 'rejected', 'purged')),
  media_format text not null default 'PHOTO' check (media_format = 'PHOTO'),
  file_name text not null check (length(file_name) between 1 and 255),
  declared_content_type text not null
    check (declared_content_type in ('image/jpeg', 'image/png')),
  declared_byte_length integer not null check (declared_byte_length > 0),
  declared_sha256 text not null check (declared_sha256 ~ '^[a-f0-9]{64}$'),
  staging_key text not null unique check (length(staging_key) <= 512),
  final_key text unique check (final_key is null or length(final_key) <= 512),
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  content_type text check (content_type is null or content_type in ('image/jpeg', 'image/png')),
  byte_length integer check (byte_length is null or byte_length > 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  rejection_code text check (rejection_code is null or length(rejection_code) <= 64),
  staging_expires_at timestamptz not null default now() + interval '24 hours',
  staging_purged_at timestamptz,
  finalised_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_asset_tenant_key unique (organisation_id, id),
  constraint media_asset_ready_complete check (
    status <> 'ready' or (
      final_key is not null and sha256 is not null and content_type is not null
      and byte_length is not null and width is not null and height is not null
      and finalised_at is not null
    )
  ),
  constraint media_asset_rejected_reason check (
    status <> 'rejected' or rejection_code is not null
  )
);
create index media_asset_recent_idx on media_asset (organisation_id, created_at desc);
create index media_asset_staging_due_idx on media_asset (staging_expires_at)
  where staging_purged_at is null;

-- A finalised asset is immutable: what was checked is what every listing
-- gets. Only the staging bookkeeping may change after `ready`.
create function media_asset_immutable() returns trigger
language plpgsql as $$
begin
  if old.status = 'ready' and (
    new.status is distinct from old.status
    or new.final_key is distinct from old.final_key
    or new.sha256 is distinct from old.sha256
    or new.content_type is distinct from old.content_type
    or new.byte_length is distinct from old.byte_length
    or new.width is distinct from old.width
    or new.height is distinct from old.height
    or new.organisation_id is distinct from old.organisation_id
  ) then
    raise exception 'media_asset % is finalised and immutable', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger media_asset_immutable before update on media_asset
  for each row execute function media_asset_immutable();

create table media_asset_publication (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  asset_id uuid not null,
  location_id uuid not null references location(id) on delete cascade,
  bulk_listing_child_id uuid,
  gbp_media_mutation_id uuid references gbp_media_mutation(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'published', 'failed', 'removed')),
  category text not null check (length(category) <= 32),
  google_media_name text check (google_media_name is null or length(google_media_name) <= 512),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  constraint media_asset_publication_asset_fk foreign key (organisation_id, asset_id)
    references media_asset (organisation_id, id) on delete cascade,
  constraint media_asset_publication_child_fk foreign key (organisation_id, bulk_listing_child_id)
    references bulk_listing_child (organisation_id, id) on delete set null (bulk_listing_child_id)
);
create unique index media_asset_publication_live_key
  on media_asset_publication (asset_id, location_id)
  where status in ('pending', 'published');
create index media_asset_publication_child_idx
  on media_asset_publication (bulk_listing_child_id);

alter table media_asset enable row level security;
alter table media_asset force row level security;
create policy tenant_isolation on media_asset
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, update on media_asset to naba_app_runtime;

alter table media_asset_publication enable row level security;
alter table media_asset_publication force row level security;
create policy tenant_isolation on media_asset_publication
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, update on media_asset_publication to naba_app_runtime;

alter table bulk_listing_operation
  drop constraint bulk_listing_operation_operation_check,
  add constraint bulk_listing_operation_operation_check check (operation in (
    'regular_hours', 'special_hours', 'more_hours', 'attributes', 'place_action',
    'business_info', 'categories', 'lodging', 'food_menus', 'post_draft', 'photos',
    'mixed'
  ));

alter table bulk_listing_child
  drop constraint bulk_listing_child_resource_key_check,
  add constraint bulk_listing_child_resource_key_check check (resource_key in (
    'hours', 'attributes', 'place_actions', 'business_info', 'lodging',
    'food_menus', 'posts', 'media'
  ));

insert into schema_migration(version) values ('0266_media_assets_bulk_photos') on conflict (version) do nothing;
commit;
