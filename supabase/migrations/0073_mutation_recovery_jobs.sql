begin;

-- ---------------------------------------------------------------------------
-- Uncertain listing writes are recovered by the job runner (plan P03-S6).
--
-- A receipt (mutation_operation, 0067) is `uncertain` when Google never said
-- whether its write landed: an ambiguous provider call, an unreadable
-- readback, or an attempt the retention cron found stranded in flight. Until
-- now nothing went back to look unless somebody repeated the same request.
--
--   claim_due_jobs      a new arm, 'mutation_recover', leases uncertain
--                       receipts whose next_recovery_at is due, below the
--                       same ceiling of 8 readbacks the reply 'recover' arm
--                       uses (MAX_MUTATION_RECOVERY_ATTEMPTS in
--                       lib/server/mutation-recovery.ts). The runner reads
--                       Google through the surface's recovery adapter and
--                       settles the receipt and its attempt; it never sends
--                       the write again.
--
--   release_job_lease   learns the new kind, so a lease is cleared on
--                       mutation_operation instead of publish_attempt.
--
--   notification kind   'mutation_unconfirmed': a receipt recovery gave up
--                       on (ceiling, a connection that is gone, a write no
--                       readback can identify) tells the owners and admins
--                       to check Google.
--
-- `claim_due_jobs` is rewritten whole from 0048 (see 0034 on why partial
-- rewrites are a hazard); every 0048 arm is unchanged, which
-- tests/jobs-migration.test.ts asserts arm by arm. The lease is the only
-- in-flight marker, so reclaim_expired_jobs needs nothing: an expired lease
-- makes the receipt claimable again on its own.
-- ---------------------------------------------------------------------------

alter table notification_incident
  drop constraint if exists notification_incident_kind_check;
alter table notification_incident
  add constraint notification_incident_kind_check check (
    kind in (
      'connection_reconnect',
      'listing_access_lost',
      'listing_stale',
      'low_rating_review',
      'connection_owner_left',
      'ai_credits_low',
      'ai_credits_exhausted',
      'mutation_unconfirmed'
    )
  );

-- Receipts already uncertain when this ships were settled with no recovery
-- time; give them one so the first tick after deploy reads them back.
update mutation_operation
set next_recovery_at = now()
where state = 'uncertain'
  and next_recovery_at is null
  and recovery_attempts < 8;

drop function if exists claim_due_jobs(integer, integer, integer, text[]);

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
    -- Uncertain listing writes (0073). A null next_recovery_at is NOT due:
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

create or replace function release_job_lease(
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
    update processed_webhook_event
       set lease_expires_at = null
     where id = p_job_id and organisation_id = p_organisation_id;
  elsif p_kind in ('checkpoint', 'reconcile', 'performance', 'keywords') then
    update sync_checkpoint
       set lease_expires_at = null
     where id = p_job_id and organisation_id = p_organisation_id;
  elsif p_kind = 'mutation_recover' then
    update mutation_operation
       set lease_expires_at = null
     where id = p_job_id and organisation_id = p_organisation_id;
  else
    update publish_attempt
       set lease_expires_at = null
     where id = p_job_id and organisation_id = p_organisation_id;
  end if;
end;
$$;

revoke all on function release_job_lease(text, uuid, uuid) from public;
grant execute on function release_job_lease(text, uuid, uuid)
  to naba_app_runtime;

insert into schema_migration (version) values ('0073_mutation_recovery_jobs')
on conflict (version) do nothing;

commit;
