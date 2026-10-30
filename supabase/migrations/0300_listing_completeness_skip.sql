begin;

-- ---------------------------------------------------------------------------
-- Listing completeness skips (S1).
--
--   listing_completeness_skip
--                       A completeness check an owner or admin has chosen to
--                       stop counting for one listing, with the reason they
--                       gave (a pub with no website, a venue that takes no
--                       bookings). The score is derived on read and never
--                       stored (lib/listings/completeness.ts); this is the
--                       only state it keeps. One row per listing and check.
--                       check_id is validated by the route against the check
--                       list in code, so a new check needs no migration.
--                       Changing a reason replaces the row (delete, insert),
--                       so the runtime role gets no update. Every skip and
--                       unskip is written to audit_log by the route.
--
-- Expand only: a new table.
-- ---------------------------------------------------------------------------

create table listing_completeness_skip (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  check_id text not null check (check_id ~ '^[a-z][a-z_]{0,63}$'),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  created_by uuid references app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organisation_id, location_id, check_id)
);
-- The unique index serves reads by organisation and listing; this one serves
-- the cascade from location.
create index listing_completeness_skip_location_idx
  on listing_completeness_skip (location_id);

alter table listing_completeness_skip enable row level security;
alter table listing_completeness_skip force row level security;
create policy tenant_isolation on listing_completeness_skip
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, delete on listing_completeness_skip to naba_app_runtime;

insert into schema_migration(version) values ('0300_listing_completeness_skip') on conflict (version) do nothing;
commit;
