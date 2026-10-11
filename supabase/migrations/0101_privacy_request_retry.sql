begin;

-- ---------------------------------------------------------------------------
-- Background-resumable privacy withdrawals (plan P04-5).
--
-- An erasure whose reply Google would not withdraw is parked `in_progress`
-- with `pending_review_ids` (0041). Until now only an owner re-fulfilling it
-- by hand could finish it. The job tick (lib/server/privacy/withdrawals.ts,
-- called from runDueJobs) now retries it with backoff until every reply is
-- withdrawn, the retry budget is spent, or a human resolves it.
--
--   withdrawal_actor_id           the owner whose fulfil parked the request.
--                                 The worker re-derives that person's grant
--                                 from membership at dispatch
--                                 (lib/server/authz/actor.ts); never a stored
--                                 role. Set null when the user row goes, which
--                                 the worker reads as a revoked actor.
--   withdrawal_attempts           withdrawal rounds tried so far, the inline
--                                 one in the PATCH included. A paused provider
--                                 does not count.
--   next_attempt_at               when the tick may retry. Null on an open
--                                 request means no automatic retry is coming
--                                 (budget spent, actor revoked, legal hold):
--                                 the console surfaces it for a human.
--   last_error_code               why the last round left work outstanding.
--   withdrawal_lease_expires_at   the claim lease, so two ticks never run the
--                                 same request at once; an expired lease is
--                                 claimable again.
--
-- claim_due_privacy_withdrawals is a separate SECURITY DEFINER claim, like
-- claim_due_publication_schedules (0079), rather than another arm in
-- claim_due_jobs (0048): a whole-function rewrite of that claim is the
-- hazard 0034/0048 warn about.
-- ---------------------------------------------------------------------------

alter table privacy_request
  add column if not exists withdrawal_actor_id uuid
    references app_user(id) on delete set null;

alter table privacy_request
  add column if not exists withdrawal_attempts integer not null default 0
    check (withdrawal_attempts >= 0);

alter table privacy_request
  add column if not exists next_attempt_at timestamptz;

alter table privacy_request
  add column if not exists last_error_code text
    check (last_error_code is null or length(last_error_code) <= 120);

alter table privacy_request
  add column if not exists withdrawal_lease_expires_at timestamptz;

create index if not exists privacy_request_withdrawal_due_idx
  on privacy_request (next_attempt_at)
  where status = 'in_progress' and next_attempt_at is not null;

-- Across tenants, oldest due first, at most p_per_org per organisation so one
-- tenant's backlog cannot starve the rest of a tick.
create or replace function claim_due_privacy_withdrawals(
  p_limit integer,
  p_lease_seconds integer,
  p_per_org integer
)
returns table (organisation_id uuid, privacy_request_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select
      pr.id,
      pr.organisation_id,
      pr.next_attempt_at,
      row_number() over (
        partition by pr.organisation_id
        order by pr.next_attempt_at, pr.id
      ) as rn
    from privacy_request pr
    where pr.status = 'in_progress'
      and pr.next_attempt_at is not null
      and pr.next_attempt_at <= now()
      and (
        pr.withdrawal_lease_expires_at is null
        or pr.withdrawal_lease_expires_at < now()
      )
  ), chosen as (
    select due.id
    from due
    where due.rn <= p_per_org
    order by due.next_attempt_at, due.id
    limit p_limit
  )
  update privacy_request pr
  set withdrawal_lease_expires_at =
    now() + make_interval(secs => p_lease_seconds)
  from chosen
  where pr.id = chosen.id
    -- Re-checked on the row: a concurrent claim that won it first has set a
    -- live lease, and READ COMMITTED re-evaluates this against that version.
    and pr.status = 'in_progress'
    and (
      pr.withdrawal_lease_expires_at is null
      or pr.withdrawal_lease_expires_at < now()
    )
  returning pr.organisation_id, pr.id;
end $$;

revoke all on function claim_due_privacy_withdrawals(integer, integer, integer)
  from public;
grant execute on function claim_due_privacy_withdrawals(integer, integer, integer)
  to naba_app_runtime;

insert into schema_migration (version)
values ('0101_privacy_request_retry')
on conflict (version) do nothing;

commit;
