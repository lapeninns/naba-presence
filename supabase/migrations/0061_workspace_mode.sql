begin;

-- ---------------------------------------------------------------------------
-- Workspace mode and the hidden home client.
--
-- A business-mode organisation has exactly one client row with is_home = true
-- and every location is filed under it, so RLS, permissions and client scoping
-- keep working unchanged. Agency mode stays available as a value.
-- ---------------------------------------------------------------------------
-- The column default is 'agency' (the pre-existing behaviour) so an insert
-- that does not provision a home client (an old app instance still running
-- between migration and deploy, scripts, support tooling) can never produce a
-- business organisation without a home. Provisioning sets 'business' itself,
-- in the same transaction that creates the home client; the backfill below
-- promotes the eligible existing organisations.
alter table organisation add column workspace_mode text not null
  default 'agency' check (workspace_mode in ('business', 'agency'));
alter table client add column is_home boolean not null default false;
create unique index client_one_home on client (organisation_id) where is_home;

-- Backfill, per organisation. Runs as the migration role, outside any tenant
-- transaction, so it spans every organisation (RLS is FORCE-d for
-- naba_app_runtime, not for the owner running migrations).
--   0 clients : create the home client (named after the organisation).
--   1 client  : if it is active it becomes the home client. An archived sole
--               client is never restored; the organisation stays in agency
--               mode and is listed in a notice.
--   >1 clients: stay agency, nothing else changes; listed in a notice.
-- Unassigned locations are filed under the home client. Organisations whose
-- unassigned locations would join a client that has report shares are listed
-- in a notice, because the share then exposes listings it never did.
do $$
declare
  org record;
  client_total integer;
  home_id uuid;
  base_slug text;
  agency_orgs text[] := '{}';
  share_orgs text[] := '{}';
  sole_archived timestamptz;
begin
  for org in select id, name from organisation order by id loop
    select count(*) into client_total from client where organisation_id = org.id;

    if client_total > 1 then
      update organisation set workspace_mode = 'agency' where id = org.id;
      agency_orgs := agency_orgs || org.id::text;
      continue;
    end if;

    if client_total = 1 then
      select archived_at into sole_archived from client where organisation_id = org.id;
      if sole_archived is not null then
        agency_orgs := agency_orgs || org.id::text;
        continue;
      end if;
    end if;

    if client_total = 0 then
      base_slug := trim(both '-' from regexp_replace(lower(org.name), '[^a-z0-9]+', '-', 'g'));
      if base_slug = '' then
        base_slug := 'home';
      end if;
      -- Uniquify against the organisation's existing slugs.
      while exists (
        select 1 from client where organisation_id = org.id and slug = base_slug
      ) loop
        base_slug := base_slug || '-home';
      end loop;
      insert into client (organisation_id, name, slug, is_home)
      values (org.id, org.name, base_slug, true)
      returning id into home_id;
    else
      select id into home_id from client where organisation_id = org.id;
      update client set is_home = true where id = home_id;
      if exists (select 1 from location where organisation_id = org.id and client_id is null)
         and exists (select 1 from report_share where client_id = home_id) then
        share_orgs := share_orgs || org.id::text;
      end if;
    end if;

    update location
       set client_id = home_id
     where organisation_id = org.id and client_id is null;
    update organisation set workspace_mode = 'business' where id = org.id;
  end loop;

  if cardinality(share_orgs) > 0 then
    raise notice 'workspace_mode: % organisation(s) had unassigned locations filed under a client that has report shares; review those shares: %',
      cardinality(share_orgs), array_to_string(share_orgs, ', ');
  end if;
  if cardinality(agency_orgs) > 0 then
    raise notice 'workspace_mode: % organisation(s) with several clients, or only an archived client, stay in agency mode and need a manual decision: %',
      cardinality(agency_orgs), array_to_string(agency_orgs, ', ');
  end if;
end $$;

-- Database-level guards for the home client, so a writer other than the
-- route handlers (support tooling, scripts) cannot break the invariant that a
-- business organisation's locations stay under its home client.
create function client_guard_home() returns trigger
language plpgsql as $$
begin
  if old.is_home and new.archived_at is not null and old.archived_at is null then
    raise exception 'the home client cannot be archived' using errcode = '23514';
  end if;
  if old.is_home and not new.is_home
     and exists (select 1 from organisation o
                 where o.id = old.organisation_id and o.workspace_mode = 'business') then
    raise exception 'the home client of a business organisation cannot be demoted'
      using errcode = '23514';
  end if;
  return new;
end $$;
create trigger client_guard_home before update on client
  for each row execute function client_guard_home();

create function location_guard_home() returns trigger
language plpgsql as $$
begin
  if old.client_id is distinct from new.client_id
     and old.client_id is not null
     and exists (select 1 from client c
                 join organisation o on o.id = c.organisation_id
                 where c.id = old.client_id and c.is_home
                   and o.workspace_mode = 'business') then
    raise exception 'a business-mode location cannot leave the home client'
      using errcode = '23514';
  end if;
  return new;
end $$;
create trigger location_guard_home before update of client_id on location
  for each row execute function location_guard_home();

insert into schema_migration (version)
values ('0061_workspace_mode') on conflict (version) do nothing;
commit;
