begin;

-- ---------------------------------------------------------------------------
-- Every location of a business workspace sits under its home client
-- (plan P06-5, completing 0102).
--
-- 0102 serialises client writes with the agency-to-business switch, but
-- location writers did not take the organisation lock: the routes and the
-- automatic Google setup read the home client (businessHomeClientId) without
-- a lock, and 0061's location_guard_home only fires on UPDATE of a location
-- already under the home client. A location inserted with client_id null in
-- a transaction that commits after the switch's refile statement started
-- stayed unassigned once the mode became business, and the switch's count of
-- locations it would refile (which decides whether live report shares are
-- widened) could go stale.
--
-- This trigger takes FOR SHARE on the organisation row for every location
-- insert and every update of client_id. The switch holds FOR UPDATE on the
-- same row, so the two serialise. In business mode a location with no client
-- is filed under the home client, and any other client is refused (23514).
-- In agency mode nothing changes.
--
-- Triggers of the same event fire in name order, so 0061's
-- location_guard_home still refuses a business location leaving its home
-- client before this one could fill the null back in.
-- ---------------------------------------------------------------------------
create function location_require_business_home() returns trigger
language plpgsql as $$
declare
  mode text;
  home uuid;
begin
  select workspace_mode into mode
  from organisation
  where id = new.organisation_id
  for share;
  if mode is distinct from 'business' then
    return new;
  end if;
  select id into home
  from client
  where organisation_id = new.organisation_id and is_home;
  if home is null then
    return new;
  end if;
  if new.client_id is null then
    new.client_id := home;
  elsif new.client_id <> home then
    raise exception 'a business-mode location belongs under the home client'
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger location_require_business_home
  before insert or update of client_id on location
  for each row execute function location_require_business_home();

insert into schema_migration (version)
values ('0103_location_business_home') on conflict (version) do nothing;
commit;
