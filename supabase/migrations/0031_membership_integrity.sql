begin;

-- ---------------------------------------------------------------------------
-- Membership integrity: grants die with the membership, an organisation never
-- loses its last owner, and sessions can be revoked in bulk.
--
-- Three invariants that lived only in application code -- and, in one case,
-- nowhere at all:
--
--   1. location_member (0001_initial.sql:168) has foreign keys to
--      organisation, location and app_user but none to member, and
--      DELETE /api/members only deletes the member row. Every per-location
--      grant survived. grantsFor (lib/server/permissions.ts) treats a single
--      surviving row as "this user has assignments" and in that branch
--      ignores the organisation-level can_publish, so a removed member
--      re-invited with canPublish false came back able to publish exactly
--      the locations the admin thought they had just denied.
--
--   2. The last-owner rule was written in three places and read without a
--      lock, so two concurrent demotions both saw two owners and both
--      committed. There is no recovery path: assertRoleChangeAllowed only
--      grants 'owner' when the actor is already one.
--
--   3. Sessions could only be deleted one presented cookie at a time, so
--      completing a password reset could not evict a stolen one. app_session
--      RLS is organisation- or token-scoped, so a purge that spans every
--      organisation a user belongs to needs a definer.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Per-location grants follow the membership.
--
-- SECURITY DEFINER because the trigger also has to fire for cascade deletes,
-- which carry no app.organisation_id, and location_member has FORCE RLS.
-- ---------------------------------------------------------------------------
create or replace function prune_location_member_on_member_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from location_member
   where organisation_id = old.organisation_id
     and user_id = old.user_id;
  return null;
end;
$$;

drop trigger if exists member_prune_location_grants on member;
create trigger member_prune_location_grants
  after delete on member
  for each row
  execute function prune_location_member_on_member_delete();

-- Grants already orphaned by a removal that predates the trigger.
delete from location_member lm
 where not exists (
   select 1
   from member m
   where m.organisation_id = lm.organisation_id
     and m.user_id = lm.user_id
 );

-- ---------------------------------------------------------------------------
-- 2. An organisation that had an owner keeps one.
--
-- The backstop for every writer, present and future: the routes still take a
-- row lock and answer 409 last_owner, which is what makes concurrent
-- demotions serialise into a clean error instead of this exception.
--
-- SECURITY DEFINER for the same reason as above -- the app_user probe below
-- must see the real row, and under RLS the member row it would be read
-- through has just been deleted.
-- ---------------------------------------------------------------------------
create or replace function assert_organisation_retains_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role <> 'owner' then
    return null;
  end if;
  -- An ON DELETE CASCADE from organisation or app_user is not a demotion:
  -- the membership is leaving with one of its parents.
  if not exists (select 1 from organisation where id = old.organisation_id)
    or not exists (select 1 from app_user where id = old.user_id)
  then
    return null;
  end if;
  if not exists (
    select 1
    from member
    where organisation_id = old.organisation_id
      and role = 'owner'
  ) then
    raise exception 'last_owner_required';
  end if;
  return null;
end;
$$;

drop trigger if exists member_last_owner_guard on member;
create trigger member_last_owner_guard
  after update or delete on member
  for each row
  execute function assert_organisation_retains_owner();

-- ---------------------------------------------------------------------------
-- 3. Bulk session revocation.
--
-- p_except_token_hash keeps the session the caller has just minted alive, so
-- a password reset can revoke everything else without signing the user out of
-- the browser they are sitting in front of.
-- ---------------------------------------------------------------------------
create or replace function revoke_user_sessions(
  p_user_id uuid,
  p_except_token_hash text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revoked integer;
begin
  delete from app_session
   where user_id = p_user_id
     and (p_except_token_hash is null or token_hash <> p_except_token_hash);
  get diagnostics v_revoked = row_count;
  return v_revoked;
end;
$$;

revoke all on function prune_location_member_on_member_delete() from public;
revoke all on function assert_organisation_retains_owner() from public;
revoke all on function revoke_user_sessions(uuid, text) from public;

grant execute on function prune_location_member_on_member_delete()
  to naba_app_runtime;
grant execute on function assert_organisation_retains_owner()
  to naba_app_runtime;
grant execute on function revoke_user_sessions(uuid, text)
  to naba_app_runtime;

insert into schema_migration (version)
values ('0031_membership_integrity')
on conflict (version) do nothing;

commit;
