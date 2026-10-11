begin;

-- ---------------------------------------------------------------------------
-- Authorised dispatch and approval assurance (P02-S9, ledger AUTH-05).
--
-- 1. publish_attempt records who authorised the reply mutation and under
--    what: the person (authorised_by), the session's assurance level and
--    when its code was verified, the person's security_version at the time
--    and the Google connection the mutation was prepared against. The retry
--    worker (lib/server/publishing/retry.ts) re-decides from these before
--    every re-dispatch: the person must still be a member allowed to publish
--    at the location, the location must still be served by that connection,
--    and the person's security_version must not have moved on (operator MFA
--    recovery, scripts/mfa-recover.mjs). A row with no authorised_by (queued
--    before this migration, or its person deleted) cannot be rechecked and is
--    settled failed rather than sent.
--
-- 2. Every approval records the assurance it was given with: the reply
--    approval_decision, the post_approval_decision (0081), the listing
--    mutation_approval_decision (0094), and approved_* beside approved_by on
--    the reviewed gbp_change_set (0063), the post_publication_schedule (0079)
--    and the bulk_listing_operation (0080). The deciding person is already
--    there (decided_by / approved_by). Evidence for audit; nullable, because
--    decisions made before this migration have none. A schedule revision
--    clears its approved_* with approved_by.
--
-- 3. recover_user_mfa: operator MFA recovery for a person who lost their
--    authenticator apps (scripts/mfa-recover.mjs is the entry point, which
--    also deletes the factors at the auth provider). It bumps the person's
--    security_version, which ends every session they hold (lookupSession)
--    and stops every queued dispatch they authorised
--    (recheckAuthorisation); deletes their sessions and pending MFA tickets;
--    zeroes mfa_factor_count, so the next sensitive action asks them to
--    enroll afresh; and writes one user.mfa_recovered audit row per
--    organisation they belong to. Not for the application: execute is
--    revoked from public and naba_app_runtime, like
--    revoke_support_sessions (0084).
-- ---------------------------------------------------------------------------

set local lock_timeout = '5s';

alter table publish_attempt
  add column if not exists authorised_by uuid
    references app_user(id) on delete set null,
  add column if not exists authorised_aal text
    check (authorised_aal is null or authorised_aal in ('aal1', 'aal2')),
  add column if not exists authorised_mfa_verified_at timestamptz,
  add column if not exists authorised_security_version integer
    check (authorised_security_version is null or authorised_security_version >= 1),
  add column if not exists authorised_connection_id uuid;

alter table approval_decision
  add column if not exists authorised_aal text
    check (authorised_aal is null or authorised_aal in ('aal1', 'aal2')),
  add column if not exists authorised_mfa_verified_at timestamptz,
  add column if not exists authorised_security_version integer
    check (authorised_security_version is null or authorised_security_version >= 1);

alter table post_approval_decision
  add column if not exists authorised_aal text
    check (authorised_aal is null or authorised_aal in ('aal1', 'aal2')),
  add column if not exists authorised_mfa_verified_at timestamptz,
  add column if not exists authorised_security_version integer
    check (authorised_security_version is null or authorised_security_version >= 1);

alter table mutation_approval_decision
  add column if not exists authorised_aal text
    check (authorised_aal is null or authorised_aal in ('aal1', 'aal2')),
  add column if not exists authorised_mfa_verified_at timestamptz,
  add column if not exists authorised_security_version integer
    check (authorised_security_version is null or authorised_security_version >= 1);

alter table gbp_change_set
  add column if not exists approved_aal text
    check (approved_aal is null or approved_aal in ('aal1', 'aal2')),
  add column if not exists approved_mfa_verified_at timestamptz,
  add column if not exists approved_security_version integer
    check (approved_security_version is null or approved_security_version >= 1);

-- Schedule (0079) and bulk listing (0080) approvals: table-level update
-- grants already cover these columns.
alter table post_publication_schedule
  add column if not exists approved_aal text
    check (approved_aal is null or approved_aal in ('aal1', 'aal2')),
  add column if not exists approved_mfa_verified_at timestamptz,
  add column if not exists approved_security_version integer
    check (approved_security_version is null or approved_security_version >= 1);

alter table bulk_listing_operation
  add column if not exists approved_aal text
    check (approved_aal is null or approved_aal in ('aal1', 'aal2')),
  add column if not exists approved_mfa_verified_at timestamptz,
  add column if not exists approved_security_version integer
    check (approved_security_version is null or approved_security_version >= 1);

-- gbp_change_set keeps column-level update grants (0063): the approval
-- writes its assurance in the same statement as approved_by.
grant update (approved_aal, approved_mfa_verified_at, approved_security_version)
  on gbp_change_set to naba_app_runtime;

create or replace function recover_user_mfa(
  p_user_id uuid,
  p_operator text,
  p_reason text
)
returns table (
  security_version integer,
  revoked_sessions integer,
  organisations integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_operator text := nullif(btrim(coalesce(p_operator, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_version integer;
  v_provider text;
  v_subject text;
  v_sessions integer;
  v_organisations integer;
begin
  if v_operator is null then
    raise exception 'recover_user_mfa: operator is required'
      using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) < 10 then
    raise exception 'recover_user_mfa: a reason of at least 10 characters is required'
      using errcode = '22023';
  end if;

  update app_user u
  set security_version = u.security_version + 1,
      mfa_factor_count = 0
  where u.id = p_user_id
  returning u.security_version, u.auth_provider, u.auth_subject
    into v_version, v_provider, v_subject;
  if v_version is null then
    raise exception 'recover_user_mfa: no such user'
      using errcode = 'P0002';
  end if;

  with revoked as (
    delete from app_session s where s.user_id = p_user_id returning 1
  )
  select count(*)::integer into v_sessions from revoked;

  if v_provider is not null and v_subject is not null then
    delete from mfa_pending_login t
    where t.auth_provider = v_provider
      and t.auth_subject = v_subject;
  end if;
  delete from mfa_pending_login t where t.user_id = p_user_id;

  with audited as (
    insert into audit_log (
      organisation_id, action, subject_type, subject_id, metadata
    )
    select
      m.organisation_id,
      'user.mfa_recovered',
      'user',
      p_user_id::text,
      jsonb_build_object(
        'operator', left(v_operator, 200),
        'reason', left(v_reason, 500),
        'securityVersion', v_version,
        'revokedSessions', v_sessions
      )
    from member m
    where m.user_id = p_user_id
    returning 1
  )
  select count(*)::integer into v_organisations from audited;

  return query select v_version, v_sessions, v_organisations;
end;
$$;

revoke all on function recover_user_mfa(uuid, text, text) from public;
revoke all on function recover_user_mfa(uuid, text, text) from naba_app_runtime;

insert into schema_migration (version) values ('0201_authorised_dispatch')
on conflict (version) do nothing;

commit;
