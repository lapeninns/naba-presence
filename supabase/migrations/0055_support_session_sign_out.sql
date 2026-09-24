begin;

-- ---------------------------------------------------------------------------
-- "Sign out everywhere" from a support session ends only that session.
--
-- A support impersonation session carries the customer's user_id, so
-- revoke_user_sessions (0051) deleted every session the customer had, on
-- every device, when a support agent pressed "sign out everywhere" while
-- impersonating. The customer's own sessions are theirs to end.
-- ---------------------------------------------------------------------------

create or replace function revoke_user_sessions(p_token_hash text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_support text;
  v_count integer;
begin
  select user_id, support_actor into v_user, v_support
  from app_session
  where token_hash = p_token_hash
    and expires_at > now();
  if v_user is null then
    return 0;
  end if;
  if v_support is not null then
    delete from app_session where token_hash = p_token_hash;
  else
    delete from app_session where user_id = v_user;
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function revoke_user_sessions(text) from public;
grant execute on function revoke_user_sessions(text) to naba_app_runtime;

insert into schema_migration (version) values ('0055_support_session_sign_out')
on conflict (version) do nothing;

commit;
