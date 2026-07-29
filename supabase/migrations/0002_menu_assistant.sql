begin;

create table menu (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  public_slug text not null unique,
  name text not null,
  source_filename text not null,
  source_media_type text not null,
  source_bytes integer not null check (source_bytes > 0 and source_bytes <= 15728640),
  currency_code text,
  content_json jsonb not null check (jsonb_typeof(content_json) = 'object'),
  extraction_model text not null,
  version integer not null default 1 check (version > 0),
  is_published boolean not null default false,
  published_at timestamptz,
  imported_by uuid references app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, location_id)
);

-- This narrow routing table is intentionally outside tenant RLS. It reveals no
-- menu content and lets public menu pages resolve a tenant before entering a
-- tenant-scoped transaction.
create table public_menu_route (
  public_slug text primary key,
  organisation_id uuid not null references organisation(id) on delete cascade,
  menu_id uuid not null unique references menu(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create or replace function sync_public_menu_route()
returns trigger
language plpgsql
as $$
begin
  delete from public_menu_route where menu_id = new.id;
  insert into public_menu_route (public_slug, organisation_id, menu_id)
  values (new.public_slug, new.organisation_id, new.id);
  return new;
end;
$$;

create trigger menu_updated_at before update on menu
  for each row execute function set_updated_at();
create trigger menu_public_route_after_write
  after insert or update of public_slug, organisation_id on menu
  for each row execute function sync_public_menu_route();

alter table menu enable row level security;
alter table menu force row level security;
create policy tenant_isolation on menu using (
  organisation_id =
    nullif(current_setting('app.organisation_id', true), '')::uuid
) with check (
  organisation_id =
    nullif(current_setting('app.organisation_id', true), '')::uuid
);

insert into schema_migration (version) values ('0002_menu_assistant')
on conflict (version) do nothing;

commit;
