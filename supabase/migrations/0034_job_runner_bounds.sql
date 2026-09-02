begin;

-- ---------------------------------------------------------------------------
-- Job runner bounds: a recovery ceiling, a kind filter, an honest retry budget.
--
-- Three changes to one function body, deliberately in one migration.
-- `claim_due_jobs` is a `create or replace`, so two migrations each rewriting
-- the whole body would leave whichever ran last, silently dropping the other's
-- arm with no error.
--
--   recovery_attempts  the counter the 'recover' back-off and its ceiling are
--                      computed from. `attempt_no` could not be: nothing on
--                      the recovery path increments it (only rearmAttempt and
--                      claimRetry do), so every delay derived from it was the
--                      same delay -- an unreadable ambiguous attempt re-armed
--                      itself every 250-500 ms for ever, with no terminal
--                      state to reach.
--
--   claim_count        splits "how often was this claimed" from "how often did
--                      it actually fail". The webhook retry budget was spent at
--                      claim time, so five ticks killed at their deadline
--                      dead-lettered a healthy event that had never once been
--                      answered by Google. retry_count now moves only where a
--                      failure is observed (settleWebhookEvent's failed branch
--                      and rescheduleWebhook, both in the runner).
--
--   p_kinds            the kill switches, enforced at the claim rather than
--                      inside the runner. A claimed row is already 'running'
--                      with a lease, so skipping it after the fact re-arms it
--                      on every tick, burns a webhook's retry budget and holds
--                      it in the backlog gauge for the whole pause. Filtered
--                      here, a paused kind keeps its status and its
--                      next_attempt_at and drains when the flag comes back.
--
-- `reclaim_expired_jobs` is deliberately NOT rewritten here. It needs no
-- change -- every predicate in it is already an allowlist of in-flight
-- statuses -- and replacing a body one does not need to change is exactly the
-- hazard described above.
-- ---------------------------------------------------------------------------

alter table publish_attempt
  add column if not exists recovery_attempts integer not null default 0;

alter table processed_webhook_event
  add column if not exists claim_count integer not null default 0;

-- The old signature is dropped rather than replaced: adding a parameter to a
-- `create or replace function` creates an OVERLOAD, so the three-argument body
-- -- no kind filter, no recovery ceiling -- would stay callable and granted
-- next to the new one. `p_kinds` keeps a default so a three-argument call
-- (operator queries, tests) still works and means "every kind".
drop function if exists claim_due_jobs(integer, integer, integer);

create or replace function claim_due_jobs(
  p_limit integer,
  p_lease_seconds integer,
  p_per_org integer,
  p_kinds text[] default null
)
returns table (
  kind text,
  job_id uuid,
  organisation_id uuid,
  external_location_id uuid,
  sync_type text,
  retry_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_lease timestamptz := now() + make_interval(secs => p_lease_seconds);
begin
  return query
  with due as (
    select 'webhook_dead'::text as kind, w.id, w.organisation_id,
           w.next_attempt_at as due_at
      from processed_webhook_event w
     where w.status = 'failed'
       and w.retry_count >= 5
       and w.next_attempt_at <= v_now
       and (p_kinds is null or 'webhook_dead' = any(p_kinds))
    union all
    select 'webhook', w.id, w.organisation_id, w.next_attempt_at
      from processed_webhook_event w
     where w.status = 'failed'
       and w.retry_count < 5
       and w.next_attempt_at <= v_now
       and (p_kinds is null or 'webhook' = any(p_kinds))
    union all
    select 'checkpoint', s.id, s.organisation_id, s.next_attempt_at
      from sync_checkpoint s
     where s.status in ('pending', 'failed')
       and s.next_attempt_at <= v_now
       and s.sync_type in ('backfill', 'sweep')
       and (p_kinds is null or 'checkpoint' = any(p_kinds))
    union all
    -- The ceiling mirrors MAX_RECOVERY_ATTEMPTS in lib/server/jobs.ts, which
    -- settles the attempt terminally on the same count. Both exist: the
    -- runner writes the terminal state and its audit row, and this predicate
    -- guarantees a row can never be re-selected even if that settle is lost.
    select 'recover', p.id, p.organisation_id,
           coalesce(p.next_attempt_at, p.started_at)
      from publish_attempt p
     where p.status = 'ambiguous'
       and p.recovery_attempts < 8
       and coalesce(p.next_attempt_at, v_now) <= v_now
       and coalesce(p.lease_expires_at, '-infinity'::timestamptz) <= v_now
       and (p_kinds is null or 'recover' = any(p_kinds))
    union all
    select 'retry', p.id, p.organisation_id, p.next_attempt_at
      from publish_attempt p
     where p.status = 'retryable'
       and p.next_attempt_at <= v_now
       and coalesce(p.lease_expires_at, '-infinity'::timestamptz) <= v_now
       and (p_kinds is null or 'retry' = any(p_kinds))
  ),
  candidate as (
    select ranked.kind, ranked.id
      from (
        select d.kind, d.id, d.due_at,
               row_number() over (
                 partition by d.organisation_id
                 order by d.due_at, d.id
               ) as rn
          from due d
      ) ranked
     where ranked.rn <= p_per_org
     order by ranked.due_at, ranked.id
     limit p_limit
  ),
  -- Claimed to 'processing' like any other webhook, not straight to 'dead':
  -- the runner sets 'dead' and writes the audit row in one tenant
  -- transaction, so a row can never be dead without its audit entry. A
  -- crash in between expires the lease and the row is re-claimed as dead.
  claim_dead as (
    update processed_webhook_event p
       set status = 'processing',
           claim_count = p.claim_count + 1,
           processed_at = null,
           next_attempt_at = null,
           lease_expires_at = v_lease
     where p.id in (
       select w.id
         from processed_webhook_event w
        where w.id in (select c.id from candidate c where c.kind = 'webhook_dead')
          and w.status = 'failed'
          and w.retry_count >= 5
        for update skip locked
     )
     returning 'webhook_dead'::text as kind, p.id, p.organisation_id,
               p.external_location_id, null::text as sync_type, p.retry_count
  ),
  claim_webhook as (
    update processed_webhook_event p
       set status = 'processing',
           claim_count = p.claim_count + 1,
           processed_at = null,
           next_attempt_at = null,
           lease_expires_at = v_lease
     where p.id in (
       select w.id
         from processed_webhook_event w
        where w.id in (select c.id from candidate c where c.kind = 'webhook')
          and w.status = 'failed'
          and w.retry_count < 5
        for update skip locked
     )
     returning 'webhook'::text as kind, p.id, p.organisation_id,
               p.external_location_id, null::text as sync_type, p.retry_count
  ),
  claim_checkpoint as (
    update sync_checkpoint s
       set status = 'running',
           started_at = v_now,
           lease_expires_at = v_lease
     where s.id in (
       select c2.id
         from sync_checkpoint c2
        where c2.id in (select c.id from candidate c where c.kind = 'checkpoint')
          and c2.status in ('pending', 'failed')
        for update skip locked
     )
     returning 'checkpoint'::text as kind, s.id, s.organisation_id,
               s.external_location_id, s.sync_type, s.attempt_count as retry_count
  ),
  -- next_attempt_at is pushed past the lease rather than nulled. The recover
  -- arm treats a null as "due now", so a claim whose settle never committed
  -- -- a crashed worker, a failed reschedule -- came straight back on the
  -- next tick and read Google again, spending provider quota in a loop the
  -- recovery counter cannot bound because nothing incremented it.
  claim_recover as (
    update publish_attempt p
       set lease_expires_at = v_lease,
           next_attempt_at = v_lease
     where p.id in (
       select a.id
         from publish_attempt a
        where a.id in (select c.id from candidate c where c.kind = 'recover')
          and a.status = 'ambiguous'
          and a.recovery_attempts < 8
        for update skip locked
     )
     returning 'recover'::text as kind, p.id, p.organisation_id,
               null::uuid as external_location_id, null::text as sync_type,
               p.attempt_no as retry_count
  ),
  claim_retry as (
    update publish_attempt p
       set lease_expires_at = v_lease
     where p.id in (
       select a.id
         from publish_attempt a
        where a.id in (select c.id from candidate c where c.kind = 'retry')
          and a.status = 'retryable'
        for update skip locked
     )
     returning 'retry'::text as kind, p.id, p.organisation_id,
               null::uuid as external_location_id, null::text as sync_type,
               p.attempt_no as retry_count
  )
  select * from claim_dead
  union all select * from claim_webhook
  union all select * from claim_checkpoint
  union all select * from claim_recover
  union all select * from claim_retry;
end;
$$;

revoke all on function claim_due_jobs(integer, integer, integer, text[])
  from public;

grant execute on function claim_due_jobs(integer, integer, integer, text[])
  to naba_app_runtime;

insert into schema_migration (version)
values ('0034_job_runner_bounds')
on conflict (version) do nothing;

commit;
