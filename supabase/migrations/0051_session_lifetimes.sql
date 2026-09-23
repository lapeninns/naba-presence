begin;

-- ---------------------------------------------------------------------------
-- Platform sessions: idle and absolute lifetimes, and sign out everywhere.
--
-- A session used to live exactly 30 days from sign-in, however much it was
-- used: an operator in the app every day was signed out on day 30, and an
-- abandoned laptop stayed signed in for the full 30. Now:
--
--   expires_at            slides: every request moves it to now + the idle
--                         lifetime (14 days by default), never past...
--   absolute_expires_at   ...the hard limit from sign-in (90 days), after
--                         which a person signs in again regardless.
--
-- Nothing here touches Google. The Google grant belongs to the organisation's
-- connection and background sync never reads a session, so a session ending
-- (idle, absolute, sign-out, sign out everywhere) stops nothing but that
-- person's browser.
--
-- revoke_user_sessions is SECURITY DEFINER because app_session's policy
-- scopes a transaction to one organisation, and a person's sessions span
-- every organisation they belong to. It is keyed by the caller's own session
-- token hash, so it can only ever sign out the person presenting it.
-- ---------------------------------------------------------------------------

alter table app_session
  add column if not exists absolute_expires_at timestamptz;

update app_session
set absolute_expires_at = created_at + interval '90 days'
where absolute_expires_at is null;

create or replace function revoke_user_sessions(p_token_hash text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_count integer;
begin
  select user_id into v_user
  from app_session
  where token_hash = p_token_hash
    and expires_at > now();
  if v_user is null then
    return 0;
  end if;
  delete from app_session where user_id = v_user;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function revoke_user_sessions(text) from public;
grant execute on function revoke_user_sessions(text) to naba_app_runtime;

insert into schema_migration (version) values ('0051_session_lifetimes')
on conflict (version) do nothing;

commit;
