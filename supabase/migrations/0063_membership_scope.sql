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
-- Low-lock: the column arrives with a constant default (no rewrite), the
-- backfill touches only the rows that become 'assigned', and NOT NULL is
-- proven by a validated CHECK first so SET NOT NULL does not rescan under an
-- ACCESS EXCLUSIVE lock. Every statement is re-runnable.
-- ---------------------------------------------------------------------------

alter table member
  add column if not exists location_scope text default 'all';

do $$
declare
  batch integer;
begin
  loop
    with pending as (
      select m.organisation_id, m.user_id
      from member m
      where m.location_scope is distinct from 'assigned'
        and m.role in ('member', 'viewer')
        and exists (
          select 1 from location_member lm
          where lm.organisation_id = m.organisation_id
            and lm.user_id = m.user_id
        )
      limit 1000
    )
    update member m
    set location_scope = 'assigned'
    from pending
    where m.organisation_id = pending.organisation_id
      and m.user_id = pending.user_id;
    get diagnostics batch = row_count;
    exit when batch = 0;
  end loop;
end;
$$;

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
-- 'assigned' exactly when one of them is set.
-- ---------------------------------------------------------------------------

alter table invitation
  add column if not exists location_scope text default 'all';

update invitation
set location_scope = 'assigned'
where (client_ids is not null or location_ids is not null)
  and location_scope is distinct from 'assigned';

update invitation set location_scope = 'all' where location_scope is null;

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

insert into schema_migration (version) values ('0063_membership_scope')
on conflict (version) do nothing;

commit;
