begin;

-- ---------------------------------------------------------------------------
-- Connection lifecycle: credential generations, ownership, listing access and
-- success timestamps.
--
-- credential_generation   bumped every time the stored credential is
--                         replaced by a person (a fresh OAuth consent) or
--                         removed (disconnect). Every write that follows a
--                         Google round trip -- a refresh result, a rejected
--                         refresh, an API 401 -- carries the generation it
--                         read, and only lands if it still matches. That is
--                         what stops a refresh that started on the old
--                         credential from overwriting a reconnect, or
--                         opening a reconnect task against it, and it backs
--                         up the existing `status <> 'disconnected'` guard.
--
-- connected_by_user_id    the member who completed the consent. Nothing
--                         recorded it, so when that member left, nobody
--                         could tell the connection was running on a
--                         departed person's personal Google grant.
--                         Backfilled from the most recent connect/reconnect
--                         audit row where one exists.
--
-- google_revocation_*     the outcome of revoking the grant at Google on
--                         disconnect, kept on the row (not only in the audit
--                         log) so support can see a revoke that failed.
--
-- external_location
--   access_state          listing-level access loss (the login lost manager
--                         access to ONE location), kept apart from the
--                         connection status: it must not send anyone
--                         through Google's consent screen, and must not
--                         pause the connection's other listings.
--
-- sync_checkpoint
--   last_succeeded_at     when a sync of this kind last SUCCEEDED for the
--                         location. finished_at moves on failures too, and
--                         updated_at on every claim, so neither can answer
--                         "how fresh is this data". Backfilled from
--                         finished_at for rows currently 'succeeded'.
-- ---------------------------------------------------------------------------

alter table google_connection
  add column if not exists credential_generation integer not null default 1,
  add column if not exists connected_by_user_id uuid
    references app_user(id) on delete set null,
  add column if not exists last_error_at timestamptz,
  add column if not exists google_revocation_status text,
  add column if not exists google_revocation_at timestamptz;

alter table google_connection
  drop constraint if exists google_connection_revocation_status_check;
alter table google_connection
  add constraint google_connection_revocation_status_check
  check (
    google_revocation_status is null
    or google_revocation_status in ('revoked', 'failed', 'not_attempted')
  );

create index if not exists google_connection_connected_by_idx
  on google_connection (organisation_id, connected_by_user_id)
  where connected_by_user_id is not null;

update google_connection gc
set connected_by_user_id = latest.actor_user_id
from (
  select distinct on (a.organisation_id, a.subject_id)
    a.organisation_id,
    a.subject_id,
    a.actor_user_id
  from audit_log a
  where a.subject_type = 'google_connection'
    and a.action in (
      'google.connection.connected',
      'google.connection.reconnected'
    )
    and a.actor_user_id is not null
  order by a.organisation_id, a.subject_id, a.created_at desc
) latest
where gc.connected_by_user_id is null
  and latest.organisation_id = gc.organisation_id
  and latest.subject_id = gc.id::text;

alter table external_location
  add column if not exists access_state text not null default 'ok',
  add column if not exists access_lost_at timestamptz,
  add column if not exists access_error_code text;

alter table external_location
  drop constraint if exists external_location_access_state_check;
alter table external_location
  add constraint external_location_access_state_check
  check (access_state in ('ok', 'access_lost'));

alter table sync_checkpoint
  add column if not exists last_succeeded_at timestamptz;

update sync_checkpoint
set last_succeeded_at = finished_at
where last_succeeded_at is null
  and status = 'succeeded'
  and finished_at is not null;

create index if not exists sync_checkpoint_location_success_idx
  on sync_checkpoint (organisation_id, external_location_id, last_succeeded_at);

insert into schema_migration (version) values ('0047_connection_lifecycle')
on conflict (version) do nothing;

commit;
