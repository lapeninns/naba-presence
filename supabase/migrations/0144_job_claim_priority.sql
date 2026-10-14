begin;

-- ---------------------------------------------------------------------------
-- Job runner scheduling (WP-12; audit 2026-10-14, W8-03 and W8-05/W8-16).
--
--   job_kind_rank         who goes first when work is due at once. 0: what
--                         a user is waiting on or a provider just told us
--                         (publish retries and read-backs, uncertain
--                         listing writes, webhooks); 1: one-off backfill and
--                         sweep checkpoints; 2: the recurring reconcile,
--                         performance and keyword syncs. Every 15 minutes
--                         the whole fleet's reconcile rows fall due at the
--                         same instant, and ordering by due time alone put a
--                         reply retry that fell due a moment later behind
--                         all of them.
--
--   claim_due_jobs        orders by (kind rank, due time, id) inside the
--                         per-organisation cap and across the batch. Every
--                         0092 due arm and claim is unchanged, which
--                         tests/jobs-migration.test.ts asserts arm by arm;
--                         only the candidate ordering differs. Same
--                         signature, so code still on 0092 keeps working.
--
--   release_unstarted_job undoes a claim the runner never started. The
--                         runner now starts an item only while one provider
--                         call still fits in the tick, so the tail of a
--                         batch can be left unstarted; release_job_lease
--                         only clears the lease, which strands a webhook in
--                         'processing' or a checkpoint in 'running' until
--                         the reaper's 15-minute fallback, and leaves a
--                         read-back's due time pushed to the lease end.
--                         This puts each kind back exactly as claimable as
--                         it was, without spending any retry budget.
--
-- Rank ordering needs no new index: `due` is gathered from the existing
-- per-table due indexes before it is ranked.
-- ---------------------------------------------------------------------------

create or replace function job_kind_rank(p_kind text)
returns integer
language sql
immutable
as $$
  select case
    when p_kind in (
      'retry', 'recover', 'mutation_recover', 'webhook', 'webhook_dead'
    ) then 0
    when p_kind = 'checkpoint' then 1
    else 2
  end
$$;

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
    union all
    -- Recurring per-location work (0048). Claimed with a lease only, like
    -- 'retry': the sync function the runner calls takes the row to
    -- 'running' itself, exactly as it does for an interactive refresh, and
    -- settles it. Only locations still linked through a login that can be
    -- used: a login waiting on a reconnect would only fail, and
    -- completeAuthorisation makes its reconcile due again the moment it is
    -- reconnected.
    select s.sync_type, s.id, s.organisation_id, s.next_attempt_at
      from sync_checkpoint s
     where s.sync_type in ('reconcile', 'performance', 'keywords')
       and s.status in ('pending', 'failed', 'succeeded')
       and s.dead_lettered_at is null
       and s.next_attempt_at <= v_now
       and coalesce(s.lease_expires_at, '-infinity'::timestamptz) <= v_now
       and (p_kinds is null or s.sync_type = any(p_kinds))
       and exists (
         select 1
           from location_link ll
           join external_location e on e.id = ll.external_location_id
           join google_connection gc on gc.id = e.google_connection_id
          where ll.external_location_id = s.external_location_id
            and ll.is_active
            and gc.status in ('active', 'expired')
            and not exists (
              select 1 from connection_task ct
               where ct.google_connection_id = gc.id
                 and ct.task_type = 'reconnect'
                 and ct.status = 'open'
            )
       )
    union all
    -- Uncertain listing writes (0092). A null next_recovery_at is NOT due:
    -- the runner nulls it when it gives up on a receipt, which keeps it
    -- uncertain (the truth) without claiming it again. The ceiling mirrors
    -- MAX_MUTATION_RECOVERY_ATTEMPTS for the same reason as 'recover' above.
    -- A reconnect-blocked receipt is still claimed: the runner parks it
    -- without spending a readback, and gives up after the park limit.
    select 'mutation_recover', m.id, m.organisation_id, m.next_recovery_at
      from mutation_operation m
     where m.state = 'uncertain'
       and m.recovery_attempts < 8
       and m.next_recovery_at <= v_now
       and coalesce(m.lease_expires_at, '-infinity'::timestamptz) <= v_now
       and (p_kinds is null or 'mutation_recover' = any(p_kinds))
  ),
  candidate as (
    -- Ranked by kind first (job_kind_rank), then due order, both inside the
    -- per-organisation cap and across the batch: a reply retry that fell
    -- due after a reconcile herd is claimed ahead of it, not after every
    -- older row of its organisation.
    select ranked.kind, ranked.id
      from (
        select d.kind, d.id, d.due_at, job_kind_rank(d.kind) as kind_rank,
               row_number() over (
                 partition by d.organisation_id
                 order by job_kind_rank(d.kind), d.due_at, d.id
               ) as rn
          from due d
      ) ranked
     where ranked.rn <= p_per_org
     order by ranked.kind_rank, ranked.due_at, ranked.id
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
  ),
  -- `scheduled_for` keeps the slot this run belongs to, so the settle can
  -- schedule the next one from it rather than from whenever this run
  -- happened to finish (next_scheduled_run).
  claim_recurring as (
    update sync_checkpoint s
       set lease_expires_at = v_lease,
           scheduled_for = s.next_attempt_at
     where s.id in (
       select c2.id
         from sync_checkpoint c2
        where c2.id in (
                select c.id from candidate c
                 where c.kind in ('reconcile', 'performance', 'keywords')
              )
          and c2.status in ('pending', 'failed', 'succeeded')
          and coalesce(c2.lease_expires_at, '-infinity'::timestamptz) <= v_now
        for update skip locked
     )
     returning s.sync_type as kind, s.id, s.organisation_id,
               s.external_location_id, s.sync_type, s.attempt_count as retry_count
  ),
  -- next_recovery_at is pushed to the lease end, as claim_recover does with
  -- next_attempt_at: a claim whose settle never commits comes back once the
  -- lease has run out, not on the very next tick. retry_count carries the
  -- readbacks already spent.
  claim_mutation_recover as (
    update mutation_operation m
       set lease_expires_at = v_lease,
           next_recovery_at = v_lease
     where m.id in (
       select o.id
         from mutation_operation o
        where o.id in (
                select c.id from candidate c where c.kind = 'mutation_recover'
              )
          and o.state = 'uncertain'
          and o.recovery_attempts < 8
          and coalesce(o.lease_expires_at, '-infinity'::timestamptz) <= v_now
        for update skip locked
     )
     returning 'mutation_recover'::text as kind, m.id, m.organisation_id,
               null::uuid as external_location_id, null::text as sync_type,
               m.recovery_attempts as retry_count
  )
  select * from claim_dead
  union all select * from claim_webhook
  union all select * from claim_checkpoint
  union all select * from claim_recover
  union all select * from claim_retry
  union all select * from claim_recurring
  union all select * from claim_mutation_recover;
end;
$$;

revoke all on function claim_due_jobs(integer, integer, integer, text[])
  from public;

grant execute on function claim_due_jobs(integer, integer, integer, text[])
  to naba_app_runtime;

create or replace function release_unstarted_job(
  p_kind text,
  p_organisation_id uuid,
  p_job_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind in ('webhook', 'webhook_dead') then
    -- Back to the 'failed' row the claim took, due now. retry_count only
    -- counts failures, so nothing is spent; claim_count keeps the claim.
    update processed_webhook_event
       set status = 'failed',
           next_attempt_at = now(),
           lease_expires_at = null
     where id = p_job_id
       and organisation_id = p_organisation_id
       and status = 'processing';
  elsif p_kind = 'checkpoint' then
    -- The claim took a 'pending' or 'failed' row to 'running'; a row with
    -- no recorded error was pending.
    update sync_checkpoint
       set status = case
             when last_error_code is null then 'pending'
             else 'failed'
           end,
           lease_expires_at = null
     where id = p_job_id
       and organisation_id = p_organisation_id
       and status = 'running';
  elsif p_kind in ('reconcile', 'performance', 'keywords') then
    update sync_checkpoint
       set lease_expires_at = null
     where id = p_job_id
       and organisation_id = p_organisation_id;
  elsif p_kind = 'mutation_recover' then
    -- The claim pushed next_recovery_at to the lease end.
    update mutation_operation
       set lease_expires_at = null,
           next_recovery_at = now()
     where id = p_job_id
       and organisation_id = p_organisation_id
       and state = 'uncertain';
  elsif p_kind = 'recover' then
    -- The claim pushed next_attempt_at to the lease end.
    update publish_attempt
       set lease_expires_at = null,
           next_attempt_at = now()
     where id = p_job_id
       and organisation_id = p_organisation_id
       and status = 'ambiguous';
  else
    update publish_attempt
       set lease_expires_at = null
     where id = p_job_id
       and organisation_id = p_organisation_id;
  end if;
end;
$$;

revoke all on function release_unstarted_job(text, uuid, uuid) from public;
grant execute on function release_unstarted_job(text, uuid, uuid)
  to naba_app_runtime;

insert into schema_migration (version) values ('0144_job_claim_priority')
on conflict (version) do nothing;

commit;
