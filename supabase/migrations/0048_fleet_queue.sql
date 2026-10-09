begin;

-- ---------------------------------------------------------------------------
-- Fleet-wide scheduling as a queue.
--
-- Reconcile (every 15 minutes), performance (6 hours) and keywords (daily)
-- used to run inline in their cron request, one page of organisations per
-- fire, resumed through cron_cursor. That bounded the whole fleet by one
-- 60-second request per tick and gave no fairness inside a page. Now:
--
--   ensure_recurring_checkpoints   the cron's whole job: make sure every
--                                  linked location has a checkpoint of the
--                                  kind, and re-arm rows nothing will ever
--                                  claim again. One cheap statement for the
--                                  fleet.
--
--   claim_due_jobs                 three new arms claim due recurring rows
--                                  every minute, under the runner's existing
--                                  per-organisation cap, lease and budget.
--
--   next_scheduled_run             success schedules the next run from the
--                                  slot it was due in, not from when it
--                                  finished, so a late tick does not push
--                                  every later run back (the performance and
--                                  keyword jobs had drifted to half their
--                                  intended rate). A run that is more than one
--                                  interval late skips the missed slots
--                                  rather than replaying them: one catch-up
--                                  run, then back on the grid.
--
-- `claim_due_jobs` is rewritten whole from 0034 (see that migration on why
-- two partial rewrites are a hazard); the five existing arms are unchanged.
-- ---------------------------------------------------------------------------

alter table sync_checkpoint
  add column if not exists scheduled_for timestamptz;

create index if not exists sync_checkpoint_recurring_due_idx
  on sync_checkpoint (next_attempt_at, id)
  where sync_type in ('reconcile', 'performance', 'keywords')
    and status in ('pending', 'failed', 'succeeded');

create or replace function next_scheduled_run(
  p_scheduled timestamptz,
  p_interval interval
)
returns timestamptz
language sql
stable
as $$
  select case
    when p_scheduled is null then now() + p_interval
    else p_scheduled + p_interval * (
      greatest(
        floor(
          extract(epoch from (now() - p_scheduled))
          / extract(epoch from p_interval)
        )::integer,
        0
      ) + 1
    )
  end
$$;

grant execute on function next_scheduled_run(timestamptz, interval)
  to naba_app_runtime;

create or replace function ensure_recurring_checkpoints(p_sync_type text)
returns table (organisation_count integer, queued integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_sync_type not in ('reconcile', 'performance', 'keywords') then
    raise exception 'not a recurring sync type: %', p_sync_type;
  end if;
  return query
  with eligible as (
    select distinct e.organisation_id, e.id as external_location_id
    from location_link ll
    join external_location e on e.id = ll.external_location_id
    join google_connection gc on gc.id = e.google_connection_id
    where ll.is_active
      and gc.status in ('active', 'expired')
  ),
  armed as (
    insert into sync_checkpoint (
      organisation_id, external_location_id, sync_type, status, next_attempt_at
    )
    select organisation_id, external_location_id, p_sync_type, 'pending', now()
    from eligible
    on conflict (organisation_id, external_location_id, sync_type) do update
      set status = case
            when sync_checkpoint.status = 'cancelled' then 'pending'
            else sync_checkpoint.status
          end,
          next_attempt_at = now()
      -- Only rows nothing would otherwise claim: a settled row with no next
      -- run (written before this migration) or one a disconnect cancelled
      -- and a relink made live again. A row that is due, backing off,
      -- running, dead or dead-lettered is left exactly as it is.
      where sync_checkpoint.next_attempt_at is null
        and sync_checkpoint.dead_lettered_at is null
        and sync_checkpoint.status in ('pending', 'failed', 'succeeded', 'cancelled')
    returning organisation_id
  )
  select
    (select count(distinct organisation_id)::integer from eligible),
    (select count(*)::integer from armed);
end;
$$;

revoke all on function ensure_recurring_checkpoints(text) from public;
grant execute on function ensure_recurring_checkpoints(text) to naba_app_runtime;

-- Legacy reconcile rows settled with no next run; give them one so the
-- runner picks the fleet up on its first tick after deploy.
update sync_checkpoint
set next_attempt_at = now()
where sync_type = 'reconcile'
  and next_attempt_at is null
  and status in ('succeeded', 'pending', 'failed');

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
  )
  select * from claim_dead
  union all select * from claim_webhook
  union all select * from claim_checkpoint
  union all select * from claim_recover
  union all select * from claim_retry
  union all select * from claim_recurring;
end;
$$;

revoke all on function claim_due_jobs(integer, integer, integer, text[])
  from public;

grant execute on function claim_due_jobs(integer, integer, integer, text[])
  to naba_app_runtime;

-- The recurring kinds settle their lease on sync_checkpoint, not on
-- publish_attempt, which is where the old else-branch sent every unknown kind.
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

insert into schema_migration (version) values ('0048_fleet_queue')
on conflict (version) do nothing;

commit;
