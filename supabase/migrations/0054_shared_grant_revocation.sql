begin;

-- ---------------------------------------------------------------------------
-- Disconnect must not revoke a grant another organisation still uses.
--
-- Google revokes per Google account and Cloud project, not per token, so
-- revoking on disconnect ends every connection that login holds - including
-- one in another organisation, which RLS keeps the disconnecting tenant from
-- seeing. This answers the one question the disconnect needs across that
-- boundary: does any other live connection hold the same login? It returns a
-- boolean and nothing about the other tenant.
-- ---------------------------------------------------------------------------

create or replace function google_grant_in_use_elsewhere(p_connection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from google_connection mine
      join google_connection other
        on other.google_subject = mine.google_subject
       and other.id <> mine.id
     where mine.id = p_connection_id
       and other.status in ('active', 'expired')
  )
$$;

revoke all on function google_grant_in_use_elsewhere(uuid) from public;
grant execute on function google_grant_in_use_elsewhere(uuid)
  to naba_app_runtime;

alter table google_connection
  drop constraint if exists google_connection_revocation_status_check;
alter table google_connection
  add constraint google_connection_revocation_status_check
  check (
    google_revocation_status is null
    or google_revocation_status in (
      'revoked', 'failed', 'not_attempted', 'shared'
    )
  );

insert into schema_migration (version) values ('0054_shared_grant_revocation')
on conflict (version) do nothing;

commit;
