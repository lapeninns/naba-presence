begin;

-- ---------------------------------------------------------------------------
-- Job runner: leases, cross-tenant claiming, uniform reclaim.
--
-- Before this migration the runner (lib/server/jobs.ts) could only find work
-- by looping `organisation_job_route` and opening one tenant transaction per
-- organisation per claim -- four scans per loop iteration, O(tenants) round
-- trips to claim one item. RLS forced that shape: a tenant transaction can
-- only see its own rows.
--
-- Two SECURITY DEFINER functions replace the loop. They are the only
-- cross-tenant readers in the job path, they return ids and routing columns
-- only (never payloads), and the work itself still runs inside
-- `withTenant()` under RLS exactly as before.
--
--   claim_due_jobs()      one query, fair across tenants, leases what it claims
--   reclaim_expired_jobs() one reaper for every in-flight status
--
-- `lease_expires_at` closes the stranding hole: a crash or deploy between
-- claim and settle previously left `processed_webhook_event` at 'processing'
-- and `sync_checkpoint` at 'running' with nothing able to reclaim either,
-- because both claim predicates only matched 'failed'/'pending'.
-- ---------------------------------------------------------------------------

alter table processed_webhook_event
  add column if not exists lease_expires_at timestamptz;

alter table sync_checkpoint
  add column if not exists lease_expires_at timestamptz;

alter table publish_attempt
  add column if not exists lease_expires_at timestamptz;

-- The 0007 indexes lead with organisation_id, which suited the per-tenant
-- loop and defeats a global due-order scan. These lead with the due time.
create index if not exists webhook_due_global_idx
  on processed_webhook_event (next_attempt_at, id)
  where status = 'failed';

create index if not exists webhook_lease_idx
  on processed_webhook_event (lease_expires_at)
  where status = 'processing';

create index if not exists sync_checkpoint_due_global_idx
  on sync_checkpoint (next_attempt_at, id)
  where status in ('pending', 'failed');

create index if not exists sync_checkpoint_lease_idx
  on sync_checkpoint (lease_expires_at)
  where status = 'running';

create index if not exists publish_attempt_due_global_idx
  on publish_attempt (next_attempt_at, id)
  where status in ('retryable', 'ambiguous');

create index if not exists publish_attempt_started_idx
  on publish_attempt (started_at)
  where status = 'started';

-- ---------------------------------------------------------------------------
-- claim_due_jobs
--
-- Picks up to p_limit due items in global due order, taking at most
-- p_per_org from any one organisation so a busy tenant cannot consume the
-- whole tick budget. Candidates are ranked first (window functions and
-- UNION forbid FOR UPDATE), then each source table is claimed separately
-- with FOR UPDATE SKIP LOCKED; anything lost to a concurrent claimer is
-- simply not returned.
--
-- Every claim takes a lease. Rows carrying a live lease are not candidates,
-- which is what makes the 'retryable' and 'ambiguous' claims real claims --
-- the previous implementation selected those FOR UPDATE SKIP LOCKED without
-- writing anything, so the lock died with the transaction and the row stayed
-- claimable while it was being worked.
-- ---------------------------------------------------------------------------
create or replace function claim_due_jobs(
  p_limit integer,
  p_lease_seconds integer,
  p_per_org integer
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
    union all
    select 'webhook', w.id, w.organisation_id, w.next_attempt_at
      from processed_webhook_event w
     where w.status = 'failed'
       and w.retry_count < 5
       and w.next_attempt_at <= v_now
    union all
    select 'checkpoint', s.id, s.organisation_id, s.next_attempt_at
      from sync_checkpoint s
     where s.status in ('pending', 'failed')
       and s.next_attempt_at <= v_now
       and s.sync_type in ('backfill', 'sweep')
    union all
    select 'recover', p.id, p.organisation_id,
           coalesce(p.next_attempt_at, p.started_at)
      from publish_attempt p
     where p.status = 'ambiguous'
       and coalesce(p.next_attempt_at, v_now) <= v_now
       and coalesce(p.lease_expires_at, '-infinity'::timestamptz) <= v_now
    union all
    select 'retry', p.id, p.organisation_id, p.next_attempt_at
      from publish_attempt p
     where p.status = 'retryable'
       and p.next_attempt_at <= v_now
       and coalesce(p.lease_expires_at, '-infinity'::timestamptz) <= v_now
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
           retry_count = p.retry_count + 1,
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
  claim_recover as (
    update publish_attempt p
       set lease_expires_at = v_lease,
           next_attempt_at = null
     where p.id in (
       select a.id
         from publish_attempt a
        where a.id in (select c.id from candidate c where c.kind = 'recover')
          and a.status = 'ambiguous'
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

-- ---------------------------------------------------------------------------
-- reclaim_expired_jobs
--
-- One reaper for every in-flight status, replacing the single hardcoded
-- `started_at < now() - interval '10 minutes'` branch that only covered
-- publish attempts.
--
-- The coalesce fallbacks cover rows put in flight by the interactive paths
-- rather than the runner: the Pub/Sub push route sets 'processing' and
-- `syncLinkedLocation` sets 'running' before their own provider calls, and a
-- publish intent is written by the request handler. Those now set a lease
-- too, but the fallback keeps rows written before this migration reapable.
--
-- A stranded publish attempt becomes 'ambiguous', never 'retryable': the
-- write may have landed at Google, so it must be recovered by readback
-- rather than retried blind.
-- ---------------------------------------------------------------------------
create or replace function reclaim_expired_jobs()
returns table (kind text, reclaimed integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  return query
  with reclaimed_webhooks as (
    update processed_webhook_event
       set status = 'failed',
           last_error_code = 'lease_expired',
           next_attempt_at = v_now,
           lease_expires_at = null
     where status = 'processing'
       and coalesce(lease_expires_at, received_at + interval '15 minutes') <= v_now
     returning 1
  ),
  reclaimed_checkpoints as (
    update sync_checkpoint
       set status = 'failed',
           last_error_code = 'lease_expired',
           next_attempt_at = v_now,
           finished_at = v_now,
           lease_expires_at = null
     where status = 'running'
       and coalesce(lease_expires_at, started_at + interval '15 minutes') <= v_now
     returning 1
  ),
  reclaimed_attempts as (
    update publish_attempt
       set status = 'ambiguous',
           provider_error_code = 'lease_expired',
           next_attempt_at = v_now,
           lease_expires_at = null
     where status = 'started'
       and coalesce(lease_expires_at, started_at + interval '10 minutes') <= v_now
     returning 1
  )
  select 'webhook'::text, count(*)::integer from reclaimed_webhooks
  union all
  select 'checkpoint'::text, count(*)::integer from reclaimed_checkpoints
  union all
  select 'attempt'::text, count(*)::integer from reclaimed_attempts;
end;
$$;

-- ---------------------------------------------------------------------------
-- release_job_lease
--
-- Clears the lease once the runner has settled an item, so a row that stays
-- claimable (a retry that failed again, an ambiguous attempt still awaiting
-- readback) is immediately eligible rather than waiting out its lease.
-- Tenant-scoped: the caller passes the organisation it already holds.
-- ---------------------------------------------------------------------------
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
  elsif p_kind = 'checkpoint' then
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

revoke all on function claim_due_jobs(integer, integer, integer) from public;
revoke all on function reclaim_expired_jobs() from public;
revoke all on function release_job_lease(text, uuid, uuid) from public;

grant execute on function claim_due_jobs(integer, integer, integer)
  to naba_app_runtime;
grant execute on function reclaim_expired_jobs() to naba_app_runtime;
grant execute on function release_job_lease(text, uuid, uuid)
  to naba_app_runtime;

insert into schema_migration (version)
values ('0029_job_runner_leases')
on conflict (version) do nothing;

commit;
