begin;

-- ---------------------------------------------------------------------------
-- Audited revocation of every outstanding support impersonation session.
--
-- Support impersonation is off by default (SUPPORT_IMPERSONATION_ENABLED), and
-- with it off a support session no longer resolves. This is the release
-- operation that removes the rows themselves, across every organisation, and
-- leaves one audit_log row per affected organisation saying who did it and
-- why. scripts/revoke-support-sessions.mjs is the operator entry point.
--
-- SECURITY DEFINER because app_session's policy scopes a transaction to one
-- organisation and this spans all of them. It is not for the application:
-- execute is revoked from public and from naba_app_runtime, so only the owner
-- (the migration/operator connection) can call it.
-- ---------------------------------------------------------------------------

create or replace function revoke_support_sessions(
  p_operator text,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operator text := nullif(btrim(coalesce(p_operator, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_count integer;
begin
  if v_operator is null then
    raise exception 'revoke_support_sessions: operator is required'
      using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) < 10 then
    raise exception 'revoke_support_sessions: a reason of at least 10 characters is required'
      using errcode = '22023';
  end if;

  with revoked as (
    delete from app_session
    where support_actor is not null
    returning organisation_id, support_actor
  ),
  per_organisation as (
    select
      organisation_id,
      count(*)::integer as sessions,
      array_agg(distinct support_actor order by support_actor) as actors
    from revoked
    group by organisation_id
  ),
  audited as (
    insert into audit_log (
      organisation_id, action, subject_type, subject_id, metadata
    )
    select
      organisation_id,
      'support.sessions_revoked',
      'organisation',
      organisation_id::text,
      jsonb_build_object(
        'operator', left(v_operator, 200),
        'reason', left(v_reason, 500),
        'revokedSessions', sessions,
        'supportActors', to_jsonb(actors)
      )
    from per_organisation
  )
  -- A data-modifying CTE runs to completion whether or not it is read, so
  -- the audit insert happens even though only the count is selected here.
  select coalesce(sum(sessions), 0)::integer into v_count
  from per_organisation;

  return v_count;
end;
$$;

revoke all on function revoke_support_sessions(text, text) from public;
revoke all on function revoke_support_sessions(text, text) from naba_app_runtime;

insert into schema_migration (version) values ('0065_revoke_support_sessions')
on conflict (version) do nothing;

commit;
