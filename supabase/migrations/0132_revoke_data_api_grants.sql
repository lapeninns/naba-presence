begin;

-- SEC-11 / W6-01 / W6-02: close the Supabase Data API path into `public`.
--
-- Hosted Supabase grants `anon`, `authenticated` and `service_role` USAGE on
-- `public` and, through default privileges, ALL on every table, sequence and
-- function the migrating role (`postgres`) creates there. The 94
-- `revoke ... from public` statements in earlier migrations remove only the
-- PUBLIC pseudo-role entry, so those direct grants survive: every SECURITY
-- DEFINER function and every table without RLS was reachable through
-- PostgREST with the publishable key. The app never uses PostgREST, GraphQL
-- or supabase-js (it talks to Postgres directly as naba_app_runtime and
-- calls Auth and Storage, which run under their own roles in their own
-- schemas), so the API roles lose everything in `public`.
--
-- The roles do not exist on plain PostgreSQL (CI, verify:release), where the
-- block is a no-op. `alter default privileges` without `for role` changes the
-- migrating role's defaults only; defaults owned by `supabase_admin` (if
-- any) need the dashboard and are covered by the operator check in the PR.

do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format(
        'revoke all on all tables in schema public from %I', api_role);
      execute format(
        'revoke all on all sequences in schema public from %I', api_role);
      execute format(
        'revoke all on all functions in schema public from %I', api_role);
      execute format('revoke all on schema public from %I', api_role);
      execute format(
        'alter default privileges in schema public '
        'revoke all on tables from %I', api_role);
      execute format(
        'alter default privileges in schema public '
        'revoke all on sequences from %I', api_role);
      execute format(
        'alter default privileges in schema public '
        'revoke all on functions from %I', api_role);
    end if;
  end loop;
end
$$;

-- Policies created without a TO clause apply to every role. These three do
-- not depend on a tenant GUC, so scope them to the runtime role. The admin
-- role, which owns the SECURITY DEFINER readers, bypasses RLS either way.
alter policy webhook_route_resolve on webhook_route to naba_app_runtime;
alter policy organisation_job_route_read on organisation_job_route
  to naba_app_runtime;
alter policy organisation_provision on organisation to naba_app_runtime;

-- Local-only helper (0005): refuse anything except the fixed local identities
-- in lib/server/session.ts, so a call outside local development cannot make
-- a user owner of an arbitrary organisation. The body is otherwise unchanged;
-- `create or replace` keeps the owner and the runtime-only grant.
create or replace function provision_local_bootstrap(
  p_organisation_id uuid,
  p_user_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_organisation_id is distinct from
       '00000000-0000-4000-8000-000000000001'::uuid
     or p_user_id is distinct from
       '00000000-0000-4000-8000-000000000002'::uuid then
    raise exception 'provision_local_bootstrap is local-only'
      using errcode = 'insufficient_privilege';
  end if;
  insert into organisation (id, slug, name)
  values (p_organisation_id, 'lapen-inns', 'Lapen Inns')
  on conflict (id) do update set name = excluded.name;
  insert into app_user (id, email, display_name)
  values (p_user_id, 'local-owner@nabapresence.local', 'Local owner')
  on conflict (id) do nothing;
  insert into member (organisation_id, user_id, role, can_publish)
  values (p_organisation_id, p_user_id, 'owner', true)
  on conflict (organisation_id, user_id)
  do update set role = 'owner', can_publish = true;
end;
$$;

-- Identity primitives with no runtime caller. attach_member_user (0005) has
-- none at all; provision_google_user (0008) was reached only by the
-- test-only provisionOwner, removed in the same change. Sign-in goes through
-- provision_authenticated_user.
drop function if exists attach_member_user(text, text);
drop function if exists provision_google_user(text, text, text, boolean);

insert into schema_migration (version)
values ('0132_revoke_data_api_grants')
on conflict (version) do nothing;

commit;
