begin;

-- ---------------------------------------------------------------------------
-- Workspace mode and the hidden home client.
--
-- A business-mode organisation has exactly one client row with is_home = true
-- and every location is filed under it, so RLS, permissions and client scoping
-- keep working unchanged. Agency mode stays available as a value.
-- ---------------------------------------------------------------------------
alter table organisation add column workspace_mode text not null
  default 'business' check (workspace_mode in ('business', 'agency'));
alter table client add column is_home boolean not null default false;
create unique index client_one_home on client (organisation_id) where is_home;

-- Backfill, per organisation. Runs as the migration role, outside any tenant
-- transaction, so it spans every organisation (RLS is FORCE-d for
-- naba_app_runtime, not for the owner running migrations).
--   0 clients : create the home client (named after the organisation).
--   1 client  : that client becomes the home client (restored if archived).
--   >1 clients: stay agency, nothing else changes; listed in a notice.
do $$
declare
  org record;
  client_total integer;
  home_id uuid;
  base_slug text;
  agency_orgs text[] := '{}';
begin
  for org in select id, name from organisation order by id loop
    select count(*) into client_total from client where organisation_id = org.id;

    if client_total > 1 then
      update organisation set workspace_mode = 'agency' where id = org.id;
      agency_orgs := agency_orgs || org.id::text;
      continue;
    end if;

    if client_total = 0 then
      base_slug := trim(both '-' from regexp_replace(lower(org.name), '[^a-z0-9]+', '-', 'g'));
      if base_slug = '' then
        base_slug := 'home';
      end if;
      insert into client (organisation_id, name, slug, is_home)
      values (org.id, org.name, base_slug, true)
      returning id into home_id;
    else
      select id into home_id from client where organisation_id = org.id;
      update client set is_home = true, archived_at = null where id = home_id;
    end if;

    update location
       set client_id = home_id
     where organisation_id = org.id and client_id is null;
    update organisation set workspace_mode = 'business' where id = org.id;
  end loop;

  if cardinality(agency_orgs) > 0 then
    raise notice 'workspace_mode: % organisation(s) with more than one client stay in agency mode and need a manual decision: %',
      cardinality(agency_orgs), array_to_string(agency_orgs, ', ');
  end if;
end $$;

insert into schema_migration (version)
values ('0060_workspace_mode') on conflict (version) do nothing;
commit;
