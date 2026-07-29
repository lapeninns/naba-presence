begin;

-- ---------------------------------------------------------------------------
-- app_user: RLS with self-access (app.user_id) and member-of-current-org reads
-- ---------------------------------------------------------------------------
alter table app_user enable row level security;
alter table app_user force row level security;

create policy app_user_member_read on app_user
  for select
  using (
    exists (
      select 1 from member m
      where m.user_id = app_user.id
        and m.organisation_id =
          nullif(current_setting('app.organisation_id', true), '')::uuid
    )
  );

create policy app_user_self_read on app_user
  for select
  using (id = nullif(current_setting('app.user_id', true), '')::uuid);

create policy app_user_self_update on app_user
  for update
  using (id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (id = nullif(current_setting('app.user_id', true), '')::uuid);

-- Session bootstrap: the token-hash lookup joins app_user before the org GUC
-- exists; allow reading exactly the user attached to the presented session.
create policy app_user_session_read on app_user
  for select
  using (
    exists (
      select 1 from app_session s
      where s.user_id = app_user.id
        and s.token_hash =
          nullif(current_setting('app.session_token_hash', true), '')
    )
  );

-- All inserts and identity linking go through SECURITY DEFINER functions.
create function provision_google_user(
  p_email text,
  p_display_name text,
  p_google_subject text
) returns table (id uuid, default_organisation_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  return query
  insert into app_user as u (email, display_name, google_subject)
  values (p_email, p_display_name, p_google_subject)
  on conflict (email) do update
    set google_subject = excluded.google_subject,
        display_name = excluded.display_name
  returning u.id, u.default_organisation_id;
end;
$$;

create function attach_member_user(
  p_email text,
  p_display_name text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into app_user (email, display_name)
  values (p_email, p_display_name)
  on conflict (email) do nothing;
  select u.id into v_id from app_user u where u.email = p_email;
  return v_id;
end;
$$;

create function provision_local_bootstrap(
  p_organisation_id uuid,
  p_user_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
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

revoke all on function provision_google_user(text, text, text) from public;
revoke all on function attach_member_user(text, text) from public;
revoke all on function provision_local_bootstrap(uuid, uuid) from public;
grant execute on function provision_google_user(text, text, text)
  to naba_app_runtime;
grant execute on function attach_member_user(text, text) to naba_app_runtime;
grant execute on function provision_local_bootstrap(uuid, uuid)
  to naba_app_runtime;

-- ---------------------------------------------------------------------------
-- Routing tables: world-readable by the runtime role, tenant-checked writes
-- ---------------------------------------------------------------------------
alter table webhook_route enable row level security;
alter table webhook_route force row level security;
create policy webhook_route_resolve on webhook_route
  for select using (true);
create policy webhook_route_claim on webhook_route
  for insert
  with check (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  );
create policy webhook_route_update_own on webhook_route
  for update
  using (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  );
create policy webhook_route_delete_own on webhook_route
  for delete
  using (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  );

alter table organisation_job_route enable row level security;
alter table organisation_job_route force row level security;
create policy organisation_job_route_read on organisation_job_route
  for select using (true);
-- Rows are created only by the organisation trigger, now privileged:
alter function register_organisation_job_route() security definer
  set search_path = public;

insert into schema_migration (version) values ('0005_tenant_hardening')
on conflict (version) do nothing;

commit;
