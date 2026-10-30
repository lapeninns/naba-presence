begin;

-- ---------------------------------------------------------------------------
-- Review links: a short, tracked link per venue to Google's review form.
--
-- Table talkers, receipts and till screens are how pubs earn reviews. Each
-- location gets one link, /r/<code>, printed as a QR code. Opening it counts
-- one open (a "click") and redirects to the listing's own review form: Google's
-- metadata.newReviewUri as last read from the listing, never a URL built by
-- hand. The area page shows the clicks beside the new reviews over the same
-- days.
--
-- review_link
--   One row per location. `code` is random (10 characters from a 31-letter
--   alphabet, lib/domain/review-link.ts) and unique across every
--   organisation, because the public route resolves it before any tenant is
--   known. Rotating replaces the code in place (the old one then resolves to
--   nothing) and keeps the click history; disabling sets disabled_at. Neither
--   deletes the row. `caption` is the operator's line printed under the QR
--   code, checked by the anti-gating rule before it is saved. The link lives
--   as long as its location, so a printed code keeps working through a
--   Google disconnect and reconnect. location_id is inserted only from a
--   location the tenant can see under RLS (lib/server/review-links.ts).
--
-- review_link_click
--   One row per counted open: when, and whether it came from the QR code or
--   the link. No IP address, no user agent and nothing else about the person
--   is stored. Bots and link previews are not counted.
--
-- lookup_review_link(code)
--   The guest has no session, so the code is resolved before any tenant is
--   known -- the shape of lookup_report_share (0057). SECURITY DEFINER, and it
--   answers ONLY for a live link (not disabled), returning ids and the target.
--   An unknown, a rotated-away and a disabled code all return no row. The
--   click is then written inside withTenant(organisation_id), through RLS.
-- ---------------------------------------------------------------------------

create table review_link (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null unique references location(id) on delete cascade,
  code text not null unique
    check (code ~ '^[2-9a-hjkmnp-z]{10}$'),
  target_uri text not null
    check (target_uri ~ '^https://' and char_length(target_uri) <= 2048),
  caption text
    check (caption is null or char_length(caption) between 1 and 60),
  created_by uuid references app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rotated_at timestamptz,
  disabled_at timestamptz,
  disabled_by uuid references app_user(id) on delete set null,
  -- The click's composite key below: a click can only name a link of its
  -- own organisation.
  constraint review_link_tenant_key unique (organisation_id, id)
);

create index review_link_organisation_idx
  on review_link (organisation_id, location_id);

alter table review_link enable row level security;
alter table review_link force row level security;
create policy tenant_isolation on review_link
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );

-- No delete: disabling sets disabled_at; a location's or an organisation's
-- deletion cascades as the migration owner.
grant select, insert, update on review_link to naba_app_runtime;

create table review_link_click (
  id bigint generated always as identity primary key,
  organisation_id uuid not null references organisation(id) on delete cascade,
  link_id uuid not null,
  clicked_at timestamptz not null default now(),
  source text not null check (source in ('link', 'qr')),
  foreign key (organisation_id, link_id)
    references review_link (organisation_id, id) on delete cascade
);

create index review_link_click_link_time_idx
  on review_link_click (link_id, clicked_at);

alter table review_link_click enable row level security;
alter table review_link_click force row level security;
create policy tenant_isolation on review_link_click
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );

-- Append-only: a click is never edited or removed by the app.
grant select, insert on review_link_click to naba_app_runtime;

create function lookup_review_link(p_code text)
returns table (
  link_id uuid,
  organisation_id uuid,
  target_uri text
)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.organisation_id, l.target_uri
  from review_link l
  where l.code = p_code
    and l.disabled_at is null
  limit 1;
$$;

revoke all on function lookup_review_link(text) from public;
grant execute on function lookup_review_link(text) to naba_app_runtime;

insert into schema_migration (version) values ('0152_review_link')
on conflict (version) do nothing;

commit;
