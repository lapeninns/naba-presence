begin;

-- ---------------------------------------------------------------------------
-- Which Google logins a client's setup was started with.
--
-- The setup wizard derived "connected" from a linked location whose
-- external_location points at the connection. That only exists once a location
-- is linked, and the OAuth callback links one automatically only when the
-- login sees exactly one account with one location. A login that manages
-- several accounts or locations (an agency's shared login, or one group with
-- nine venues) came back from Google with nothing linked, so the wizard stayed
-- on Connect and bounced the operator back to it from every later step.
--
-- This row records the fact the wizard actually needs: the operator connected
-- (or picked) this login FOR this client. The callback writes it from the
-- clientId carried in the signed OAuth state, and "Use an account already
-- connected" writes it without a Google round trip.
-- ---------------------------------------------------------------------------

create table client_google_connection (
  organisation_id uuid not null references organisation(id) on delete cascade,
  client_id uuid not null references client(id) on delete cascade,
  google_connection_id uuid not null references google_connection(id) on delete cascade,
  created_by uuid references app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (client_id, google_connection_id)
);

create index client_google_connection_connection_idx
  on client_google_connection (organisation_id, google_connection_id);

alter table client_google_connection enable row level security;
alter table client_google_connection force row level security;
create policy tenant_isolation on client_google_connection
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );

grant select, insert, update, delete on client_google_connection to naba_app_runtime;

insert into schema_migration (version) values ('0045_client_google_connection')
on conflict (version) do nothing;

commit;
