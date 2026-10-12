begin;

-- ---------------------------------------------------------------------------
-- MFA foundation (P02-S8, ledger AUTH-05).
--
-- 1. app_user.security_version: a per-person counter that every session
--    carries a copy of. lookupSession (lib/server/session.ts) refuses, and
--    deletes, a session whose copy no longer matches, so bumping the counter
--    (operator MFA recovery, P02-S9) ends every session the person holds in
--    every organisation at once. It only ever increases; a trigger refuses a
--    decrease, so a request path that can update its own app_user row still
--    cannot revive old sessions by winding it back.
--
-- 2. app_user.mfa_factor_count: how many verified TOTP factors the auth
--    provider reported the last time this person authenticated or enrolled.
--    A hint for the UI (enroll, add a backup) and for P02-S9's "enroll
--    first" screen. Never a decision: whether a sign-in needs a code is
--    decided by the provider's own factor list at that moment.
--
-- 3. app_session assurance: aal ('aal1' unless the session was minted after a
--    TOTP verification), the factor used, when it was verified, until when
--    that proof counts as recent (mfa_proof_expires_at, read by P02-S9's
--    step-up check), the security_version it was minted under and how the
--    person authenticated. Existing sessions become aal1 with version 1,
--    which matches every existing app_user.
--
-- 4. mfa_pending_login: the short-lived ticket an enrolled person holds
--    between their password (or email link) and their TOTP code, and while
--    enrolling a factor. It holds the provider's access token for the
--    challenge, encrypted (lib/server/crypto.ts). Platform-level like
--    abuse_rate_bucket (0085): RLS on with no policies and select-only for
--    the runtime role, so it sees nothing; the SECURITY DEFINER functions
--    below are the only way in. A ticket is found by the hash of a random
--    value held in an httpOnly cookie, lives five minutes and allows five
--    code attempts.
-- ---------------------------------------------------------------------------

-- Both tables are altered under ACCESS EXCLUSIVE. Take the locks up front,
-- app_session before app_user (the order lookupSession's join reads them),
-- so a request holding one cannot deadlock with this migration; and give up
-- quickly rather than queue every session lookup behind a long wait. A
-- lock_timeout failure rolls back cleanly; re-run the migration.
set local lock_timeout = '5s';
lock table app_session, app_user in access exclusive mode;

alter table app_session
  add column aal text not null default 'aal1'
    check (aal in ('aal1', 'aal2')),
  add column mfa_factor_id text
    check (mfa_factor_id is null or length(mfa_factor_id) between 1 and 128),
  add column mfa_verified_at timestamptz,
  add column mfa_proof_expires_at timestamptz,
  add column security_version integer not null default 1
    check (security_version >= 1),
  add column auth_method text
    check (
      auth_method is null
      or auth_method ~ '^[a-z][a-z0-9_]{0,31}$'
    ),
  add constraint app_session_aal2_verified check (
    aal = 'aal1'
    or (
      mfa_factor_id is not null
      and mfa_verified_at is not null
      and mfa_proof_expires_at is not null
    )
  );

alter table app_user
  add column security_version integer not null default 1
    check (security_version >= 1),
  add column mfa_factor_count integer not null default 0
    check (mfa_factor_count between 0 and 10);

create or replace function app_user_security_version_monotonic()
returns trigger
language plpgsql
as $$
begin
  if new.security_version < old.security_version then
    raise exception 'security_version_decrease'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger app_user_security_version_monotonic
  before update of security_version on app_user
  for each row
  execute function app_user_security_version_monotonic();

create table mfa_pending_login (
  id uuid primary key default gen_random_uuid(),
  ticket_hash text not null unique check (length(ticket_hash) = 64),
  purpose text not null check (purpose in ('sign_in', 'enroll')),
  auth_provider text not null check (length(auth_provider) between 1 and 64),
  auth_subject text not null check (length(auth_subject) between 1 and 255),
  -- enroll: the person and the session the ticket is bound to. sign_in:
  -- null, the app user is resolved only once the code is verified.
  user_id uuid references app_user(id) on delete cascade,
  session_id uuid references app_session(id) on delete cascade,
  -- enroll: the factor being verified.
  factor_id text check (factor_id is null or length(factor_id) between 1 and 128),
  -- sign_in: the verified factors the person may answer with
  -- ([{ "id": ..., "friendlyName": ... }]).
  factors jsonb not null default '[]'::jsonb
    check (jsonb_typeof(factors) = 'array'),
  -- sign_in: what completes once the code is verified (identity,
  -- invitation token hash, password reset, auth method, and for a reset
  -- by an enrolled person the new password, encrypted until the code).
  completion jsonb not null default '{}'::jsonb
    check (jsonb_typeof(completion) = 'object'),
  provider_token_ciphertext bytea not null,
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes',
  check (purpose <> 'enroll' or (user_id is not null and session_id is not null
    and factor_id is not null))
);

create index mfa_pending_login_expires_at_idx on mfa_pending_login (expires_at);
create index mfa_pending_login_subject_idx
  on mfa_pending_login (auth_provider, auth_subject, purpose);

alter table mfa_pending_login enable row level security;
alter table mfa_pending_login force row level security;
revoke all on mfa_pending_login from public;
revoke insert, update, delete on mfa_pending_login from naba_app_runtime;
grant select on mfa_pending_login to naba_app_runtime;

-- Opens a ticket. One open ticket per identity and purpose: a new one
-- replaces any earlier one, so repeated password sign-ins cannot pile up
-- tickets (and their attempt allowances) for the same person.
create or replace function create_mfa_pending_login(
  p_ticket_hash text,
  p_purpose text,
  p_auth_provider text,
  p_auth_subject text,
  p_user_id uuid,
  p_session_id uuid,
  p_factor_id text,
  p_factors jsonb,
  p_completion jsonb,
  p_provider_token_ciphertext bytea
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  delete from mfa_pending_login
  where (auth_provider = p_auth_provider
         and auth_subject = p_auth_subject
         and purpose = p_purpose)
     or expires_at <= now();
  insert into mfa_pending_login (
    ticket_hash,
    purpose,
    auth_provider,
    auth_subject,
    user_id,
    session_id,
    factor_id,
    factors,
    completion,
    provider_token_ciphertext
  )
  values (
    p_ticket_hash,
    p_purpose,
    p_auth_provider,
    p_auth_subject,
    p_user_id,
    p_session_id,
    p_factor_id,
    coalesce(p_factors, '[]'::jsonb),
    coalesce(p_completion, '{}'::jsonb),
    p_provider_token_ciphertext
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- What the verify screen may show: the factors to choose from. No attempt
-- is counted and no token is returned.
create or replace function read_mfa_pending_login(p_ticket_hash text)
returns table (
  purpose text,
  factors jsonb,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select t.purpose, t.factors, t.expires_at
  from mfa_pending_login t
  where t.ticket_hash = p_ticket_hash
    and t.expires_at > now()
  limit 1
$$;

-- Counts one code attempt and returns the ticket, or nothing when it has
-- expired or used its allowance. The update takes the row lock, so
-- concurrent attempts are each counted once.
create or replace function take_mfa_pending_attempt(
  p_ticket_hash text,
  p_max_attempts integer
)
returns table (
  id uuid,
  purpose text,
  auth_provider text,
  auth_subject text,
  user_id uuid,
  session_id uuid,
  factor_id text,
  factors jsonb,
  completion jsonb,
  provider_token_ciphertext bytea,
  attempts integer
)
language sql
security definer
set search_path = public
as $$
  update mfa_pending_login t
  set attempts = t.attempts + 1
  where t.ticket_hash = p_ticket_hash
    and t.expires_at > now()
    and t.attempts < greatest(coalesce(p_max_attempts, 0), 0)
  returning
    t.id,
    t.purpose,
    t.auth_provider,
    t.auth_subject,
    t.user_id,
    t.session_id,
    t.factor_id,
    t.factors,
    t.completion,
    t.provider_token_ciphertext,
    t.attempts
$$;

-- Spends a ticket. True for exactly one caller: two requests verifying the
-- same ticket at once cannot both complete it.
create or replace function consume_mfa_pending_login(p_ticket_hash text)
returns boolean
language sql
security definer
set search_path = public
as $$
  with removed as (
    delete from mfa_pending_login
    where ticket_hash = p_ticket_hash
      and expires_at > now()
    returning 1
  )
  select exists (select 1 from removed)
$$;

-- Deletes a ticket whatever its state (sign-out of the verify screen, an
-- exhausted allowance).
create or replace function discard_mfa_pending_login(p_ticket_hash text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from mfa_pending_login where ticket_hash = p_ticket_hash
$$;

-- Deletes up to p_limit expired tickets; the retention cron calls it.
create or replace function purge_mfa_pending_logins(p_limit integer)
returns integer
language sql
security definer
set search_path = public
as $$
  with expired as (
    select id
    from mfa_pending_login
    where expires_at <= now()
    order by expires_at
    limit greatest(coalesce(p_limit, 0), 0)
  ),
  removed as (
    delete from mfa_pending_login t
    using expired e
    where t.id = e.id
    returning 1
  )
  select count(*)::integer from removed
$$;

revoke all on function create_mfa_pending_login(
  text, text, text, text, uuid, uuid, text, jsonb, jsonb, bytea
) from public;
revoke all on function read_mfa_pending_login(text) from public;
revoke all on function take_mfa_pending_attempt(text, integer) from public;
revoke all on function consume_mfa_pending_login(text) from public;
revoke all on function discard_mfa_pending_login(text) from public;
revoke all on function purge_mfa_pending_logins(integer) from public;

grant execute on function create_mfa_pending_login(
  text, text, text, text, uuid, uuid, text, jsonb, jsonb, bytea
) to naba_app_runtime;
grant execute on function read_mfa_pending_login(text) to naba_app_runtime;
grant execute on function take_mfa_pending_attempt(text, integer)
  to naba_app_runtime;
grant execute on function consume_mfa_pending_login(text) to naba_app_runtime;
grant execute on function discard_mfa_pending_login(text) to naba_app_runtime;
grant execute on function purge_mfa_pending_logins(integer) to naba_app_runtime;

insert into schema_migration (version) values ('0105_mfa_assurance')
on conflict (version) do nothing;

commit;
