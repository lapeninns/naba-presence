begin;

-- ---------------------------------------------------------------------------
-- Name a member's location scope instead of inferring it from rows.
--
-- lib/server/permissions.ts reads "no location_member rows" as "every
-- location". That makes zero rows a widening: the last listing deleted from
-- under an assigned member, or an admin demoted with no rows, silently sees
-- everything. The fix is an explicit scope beside the rows:
--
--   'all'      -> every location of the organisation (owners and admins are
--                 always this; their rows, if any, stay latent);
--   'assigned' -> exactly the location_member rows, and none when there are
--                 none.
--
-- This migration only ADDS the scope and backfills it so that it agrees with
-- today's rule for every row. Reads are unchanged; the writers set the scope
-- in the same transaction as the rows, and permissions.ts can log any grant
-- where the two rules disagree (SCOPE_SHADOW_COMPARE) before readers switch.
--
-- Backfill: a member or viewer holding rows is 'assigned'; everyone else is
-- 'all'. An owner or admin with rows keeps them (a later demotion makes them
-- active again, as it does today) but is 'all'.
--
-- Locking: the whole file is one transaction, so ADD COLUMN takes ACCESS
-- EXCLUSIVE on member and on invitation and holds it until commit; nothing
-- below releases it early. The column arrives with a constant default (no
-- rewrite) and NOT NULL is proven by a validated CHECK first so SET NOT NULL
-- does not scan again, which keeps the hold short on these small tables but
-- does not make it any weaker. Every statement is re-runnable.
--
-- Expand only. The deployed app does not know the scope exists until the
-- release that writes it ships, and production migrations run before that
-- deploy (docs/ci.md, "Expand, then contract"). So nothing here may refuse a
-- write the deployed code makes:
--   * member: the column defaults to 'all'. An older writer can still leave
--     the scope out of step with the rows (acceptance inserting rows under the
--     default, a client-access save or a demotion that does not touch the
--     scope). reconcile_member_location_scope() below recomputes it from the
--     rows and is re-runnable; the reader switch runs it once the writers in
--     this release are the only ones live (docs/release/ledger.md, PERM-01).
--   * invitation: a trigger names the scope 'assigned' whenever client_ids or
--     location_ids is set, so an older POST /api/invitations (client_ids, no
--     scope) still satisfies the CHECK that ties the two together.
-- ---------------------------------------------------------------------------

alter table member
  add column if not exists location_scope text default 'all';

-- The member and viewer rows rule as it reads today: rows held means
-- 'assigned', none means 'all'; owners and admins are always 'all' and their
-- rows stay latent. Recomputes every membership that disagrees and returns
-- how many it changed, so it can be run again (by the reader switch, or by
-- hand) to repair a scope an older writer left behind. It only ever moves a
-- scope to what the current row rule already grants, so running it changes
-- no one's access while readers still use the rows.
create or replace function reconcile_member_location_scope()
returns integer
language plpgsql
as $$
declare
  changed integer;
begin
  update member m
  set location_scope = target.scope
  from (
    select
      mm.organisation_id,
      mm.user_id,
      case
        when mm.role in ('member', 'viewer') and exists (
          select 1 from location_member lm
          where lm.organisation_id = mm.organisation_id
            and lm.user_id = mm.user_id
        ) then 'assigned'
        else 'all'
      end as scope
    from member mm
  ) target
  where m.organisation_id = target.organisation_id
    and m.user_id = target.user_id
    and m.location_scope is distinct from target.scope;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function reconcile_member_location_scope() from public;

select reconcile_member_location_scope();

update member set location_scope = 'all' where location_scope is null;

alter table member drop constraint if exists member_location_scope_check;
alter table member
  add constraint member_location_scope_check
  check (location_scope in ('all', 'assigned')) not valid;
alter table member validate constraint member_location_scope_check;

alter table member drop constraint if exists member_location_scope_not_null;
alter table member
  add constraint member_location_scope_not_null
  check (location_scope is not null) not valid;
alter table member validate constraint member_location_scope_not_null;
alter table member alter column location_scope set not null;
alter table member drop constraint member_location_scope_not_null;

-- ---------------------------------------------------------------------------
-- Invitations carry the same scope, copied onto the membership on
-- acceptance. A scoped invitation names either clients (0056, resolved to
-- listings when accepted) or, for a business workspace, listings directly
-- (0043's location_ids, written for the first time by this release). Never
-- both, never an empty list, never on an owner or admin, and the scope says
-- 'assigned' exactly when one of them is set (the trigger below supplies it
-- for writers that predate the column).
-- ---------------------------------------------------------------------------

alter table invitation
  add column if not exists location_scope text default 'all';

update invitation
set location_scope = 'assigned'
where (client_ids is not null or location_ids is not null)
  and location_scope is distinct from 'assigned';

update invitation set location_scope = 'all' where location_scope is null;

-- Older writers set client_ids and leave the scope at its default; name it
-- here, before the CHECK below sees the row. Never moves a scope to 'all':
-- an 'assigned' row with no ids stays refused.
create or replace function name_invitation_location_scope()
returns trigger
language plpgsql
as $$
begin
  if new.client_ids is not null or new.location_ids is not null then
    new.location_scope := 'assigned';
  end if;
  return new;
end;
$$;

revoke all on function name_invitation_location_scope() from public;

drop trigger if exists invitation_location_scope_from_targets on invitation;
create trigger invitation_location_scope_from_targets
  before insert or update on invitation
  for each row execute function name_invitation_location_scope();

alter table invitation drop constraint if exists invitation_location_scope_check;
alter table invitation
  add constraint invitation_location_scope_check
  check (
    location_scope is not null
    and location_scope in ('all', 'assigned')
    and (location_scope = 'assigned') = (client_ids is not null or location_ids is not null)
  ) not valid;
alter table invitation validate constraint invitation_location_scope_check;
alter table invitation alter column location_scope set not null;

alter table invitation drop constraint if exists invitation_location_ids_scope_check;
alter table invitation
  add constraint invitation_location_ids_scope_check
  check (
    location_ids is null
    or (
      cardinality(location_ids) > 0
      and role in ('member', 'viewer')
      and client_ids is null
    )
  ) not valid;
alter table invitation validate constraint invitation_location_ids_scope_check;

insert into schema_migration (version) values ('0082_membership_scope')
on conflict (version) do nothing;

commit;
