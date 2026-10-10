begin;

-- ---------------------------------------------------------------------------
-- Make member.location_scope the rule, and keep it from drifting open.
--
-- From this release lib/server/permissions.ts reads the scope (0082) instead
-- of inferring it from rows:
--
--   'all'      -> every location of the organisation;
--   'assigned' -> exactly the location_member rows, and NOTHING when there
--                 are none.
--
-- "No rows" never means "every location" again. That makes one direction of
-- drift dangerous: a member or viewer who holds rows but is named 'all' sees
-- every location instead of the rows. Only writers that predate 0082 can
-- leave that state (an acceptance inserting rows under the default 'all', a
-- demotion of an admin holding latent rows that does not touch the scope),
-- and they stay live between this migration and the deploy that follows it.
-- So the database itself now keeps the invariant
--
--   a member or viewer holding a location_member row is 'assigned'
--
-- by narrowing, never by refusing (an older writer must not start failing):
--
--   * inserting a location_member row for a member or viewer named 'all'
--     names them 'assigned';
--   * demoting an owner or admin who holds rows to member or viewer names
--     them 'assigned'. (Only a role change is caught: the client-access save
--     names a member 'all' and then deletes their rows, in that order.)
--
-- The 0082-aware writers already do both, so for them the triggers are
-- no-ops. 'all' with rows stays allowed for owners and admins, whose rows are
-- latent.
--
-- reconcile_member_location_scope() is redefined to only ever narrow. The
-- 0082 version moved a member or viewer with no rows to 'all', which was
-- right while "no rows" meant every location and is a widening now: an
-- assigned member whose last listing was deleted must keep seeing nothing.
-- It is run once below, and stays safe to run again at any time.
--
-- The one drift this cannot repair is the other direction: an older "every
-- client" save between migrating and deploying deletes the rows but leaves
-- the scope 'assigned', so that member sees nothing until the save is made
-- again. That is a narrowing, so it is left for an owner to redo rather than
-- guessed at here.
-- ---------------------------------------------------------------------------

create or replace function reconcile_member_location_scope()
returns integer
language plpgsql
as $$
declare
  changed integer;
begin
  update member m
  set location_scope = 'assigned'
  where m.role in ('member', 'viewer')
    and m.location_scope = 'all'
    and exists (
      select 1 from location_member lm
      where lm.organisation_id = m.organisation_id
        and lm.user_id = m.user_id
    );
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function reconcile_member_location_scope() from public;

-- A location_member row is a narrowing for a member or viewer named 'all'.
create or replace function assign_member_scope_from_row()
returns trigger
language plpgsql
as $$
begin
  update member m
  set location_scope = 'assigned'
  where m.organisation_id = new.organisation_id
    and m.user_id = new.user_id
    and m.role in ('member', 'viewer')
    and m.location_scope = 'all';
  return null;
end;
$$;

revoke all on function assign_member_scope_from_row() from public;

drop trigger if exists location_member_assigns_scope on location_member;
create trigger location_member_assigns_scope
  after insert on location_member
  for each row execute function assign_member_scope_from_row();

-- A demoted owner or admin's latent rows become their scope.
create or replace function assign_member_scope_on_demotion()
returns trigger
language plpgsql
as $$
begin
  if old.role in ('owner', 'admin')
    and new.role in ('member', 'viewer')
    and new.location_scope = 'all'
    and exists (
      select 1 from location_member lm
      where lm.organisation_id = new.organisation_id
        and lm.user_id = new.user_id
    )
  then
    new.location_scope := 'assigned';
  end if;
  return new;
end;
$$;

revoke all on function assign_member_scope_on_demotion() from public;

drop trigger if exists member_demotion_assigns_scope on member;
create trigger member_demotion_assigns_scope
  before update of role on member
  for each row execute function assign_member_scope_on_demotion();

select reconcile_member_location_scope();

insert into schema_migration (version) values ('0083_membership_scope_invariant')
on conflict (version) do nothing;

commit;
