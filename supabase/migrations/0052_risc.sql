begin;

-- ---------------------------------------------------------------------------
-- Google Cross-Account Protection (RISC) receiver support.
--
-- Google pushes signed security event tokens when a user revokes an app's
-- access, when all of an account's tokens are revoked, or when an account is
-- disabled. The receiver (/api/webhooks/google/risc) verifies each token and
-- routes it through the connection service; this migration gives it what it
-- needs to find the connection concerned and to ignore replays.
--
-- refresh_token_sha512x2 / refresh_token_prefix_sha256
--   Google identifies a revoked refresh token either by the base64 of its
--   double SHA-512, or by its first 16 characters. Neither the token nor its
--   prefix is stored in the clear: the double hash is what Google sends, and
--   the prefix is kept only as its own SHA-256. Written by the connection
--   service whenever a refresh token is stored; rows written before this
--   migration get them from the re-encryption pass, which decrypts every
--   token anyway.
--
-- risc_event
--   One row per event token (jti), platform-level like ops_heartbeat. Google
--   may deliver an event more than once; the primary key makes a replay a
--   no-op.
--
-- risc_connections_for_*
--   SECURITY DEFINER lookups across tenants: an event names a Google account
--   or token, not an organisation. They return ids only; the transition
--   itself runs inside each tenant's own transaction.
-- ---------------------------------------------------------------------------

alter table google_connection
  add column if not exists refresh_token_sha512x2 text,
  add column if not exists refresh_token_prefix_sha256 text;

create index if not exists google_connection_risc_hash_idx
  on google_connection (refresh_token_sha512x2)
  where refresh_token_sha512x2 is not null;
create index if not exists google_connection_risc_prefix_idx
  on google_connection (refresh_token_prefix_sha256)
  where refresh_token_prefix_sha256 is not null;
create index if not exists google_connection_subject_idx
  on google_connection (google_subject);

create table risc_event (
  jti text primary key,
  received_at timestamptz not null default now(),
  event_types text[] not null,
  matched_connections integer not null default 0,
  outcome text not null
);

grant select, insert, update on risc_event to naba_app_runtime;

create or replace function risc_connections_for_subject(p_subject text)
returns table (organisation_id uuid, connection_id uuid)
language sql
security definer
set search_path = public
as $$
  select gc.organisation_id, gc.id
  from google_connection gc
  where gc.google_subject = p_subject
    and gc.status <> 'disconnected'
$$;

create or replace function risc_connections_for_token(
  p_sha512x2 text,
  p_prefix_sha256 text
)
returns table (organisation_id uuid, connection_id uuid)
language sql
security definer
set search_path = public
as $$
  select gc.organisation_id, gc.id
  from google_connection gc
  where gc.status <> 'disconnected'
    and (
      (p_sha512x2 is not null and gc.refresh_token_sha512x2 = p_sha512x2)
      or (p_prefix_sha256 is not null and gc.refresh_token_prefix_sha256 = p_prefix_sha256)
    )
$$;

revoke all on function risc_connections_for_subject(text) from public;
revoke all on function risc_connections_for_token(text, text) from public;
grant execute on function risc_connections_for_subject(text) to naba_app_runtime;
grant execute on function risc_connections_for_token(text, text) to naba_app_runtime;

insert into schema_migration (version) values ('0052_risc')
on conflict (version) do nothing;

commit;
