begin;

-- ---------------------------------------------------------------------------
-- 0225: Stripe webhook inbox and processing (plan P07-S4).
--
-- billing_event is the receipt of one signed Stripe event, written by
-- /api/webhooks/stripe before it answers 200 and processed later by the job
-- tick (lib/server/billing/process-events.ts). An event is only a trigger:
-- the processor fetches the subscription's current state from Stripe and
-- applies that, so duplicate, late and reordered deliveries converge.
--
-- The row is content-free routing data, like webhook_route: the Stripe ids
-- needed to find the organisation, the event type and a hash of the signed
-- body. The payload itself is never stored. The table is platform-level (an
-- event arrives before anyone knows its organisation) and the runtime role
-- has no privilege on it at all: it records, claims and settles rows only
-- through the SECURITY DEFINER functions below, so nothing in the app can
-- read or rewrite another tenant's receipts.
--
-- Statuses:
--   received    recorded, due now;
--   processing  claimed under a lease; an expired lease is claimed again
--               (a worker that died mid-process), counting one attempt;
--   processed   applied;
--   held        the customer is not linked to any organisation yet; retried
--               with back-off and never dead-lettered (not dropped);
--   failed      the attempt failed; retried with back-off;
--   dead        failed `p_max_retries` times; needs an operator;
--   ignored     an event type the processor does not act on.
--
-- INTEGRATION: retention inventory (P04-4) must classify billing_event; no
-- purge exists yet, and a held event retries every 15 minutes until its
-- customer is linked or an operator settles it.
-- ---------------------------------------------------------------------------

set local lock_timeout = '5s';

create table billing_event (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'stripe' check (provider = 'stripe'),
  external_event_id text not null
    check (external_event_id ~ '^evt_[A-Za-z0-9_]{1,250}$'),
  event_type text not null check (length(event_type) between 1 and 120),
  livemode boolean not null,
  -- Set only for Connect events, which this platform does not expect.
  account_id text
    check (account_id is null or account_id ~ '^acct_[A-Za-z0-9]{1,250}$'),
  -- The customer the event's object belongs to: the routing key.
  stripe_customer_id text
    check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,250}$'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  event_created_at timestamptz not null,
  -- Resolved from stripe_customer_id when the event is claimed.
  organisation_id uuid references organisation (id) on delete set null,
  status text not null default 'received' check (
    status in (
      'received',
      'processing',
      'processed',
      'held',
      'failed',
      'dead',
      'ignored'
    )
  ),
  retry_count integer not null default 0 check (retry_count >= 0),
  next_attempt_at timestamptz,
  lease_expires_at timestamptz,
  last_error_code text
    check (last_error_code is null or length(last_error_code) <= 64),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, external_event_id),
  check (status <> 'processing' or lease_expires_at is not null)
);

create index billing_event_due_idx
  on billing_event (next_attempt_at, received_at)
  where status in ('received', 'held', 'failed');
create index billing_event_lease_idx
  on billing_event (lease_expires_at)
  where status = 'processing';
create index billing_event_organisation_idx
  on billing_event (organisation_id)
  where organisation_id is not null;

alter table billing_event enable row level security;
alter table billing_event force row level security;
-- No policy: only the definer functions below touch the table.
revoke all on billing_event from public;

-- Records one verified event. Idempotent on the Stripe event id: a
-- redelivery returns the existing row with inserted = false and changes
-- nothing. An event type the processor does not act on is recorded as
-- 'ignored', so the receipt still exists.
create function record_billing_event(
  p_external_event_id text,
  p_event_type text,
  p_livemode boolean,
  p_account_id text,
  p_stripe_customer_id text,
  p_payload_hash text,
  p_event_created_at timestamptz,
  p_handled boolean
)
returns table (id uuid, inserted boolean, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into billing_event (
    external_event_id,
    event_type,
    livemode,
    account_id,
    stripe_customer_id,
    payload_hash,
    event_created_at,
    status,
    next_attempt_at,
    processed_at
  )
  values (
    p_external_event_id,
    p_event_type,
    p_livemode,
    p_account_id,
    p_stripe_customer_id,
    p_payload_hash,
    p_event_created_at,
    case when p_handled then 'received' else 'ignored' end,
    case when p_handled then now() else null end,
    case when p_handled then null else now() end
  )
  on conflict (provider, external_event_id) do nothing
  returning billing_event.id into v_id;

  if v_id is not null then
    return query
      select e.id, true, e.status from billing_event e where e.id = v_id;
  else
    return query
      select e.id, false, e.status
      from billing_event e
      where e.provider = 'stripe'
        and e.external_event_id = p_external_event_id;
  end if;
end;
$$;

-- Claims up to p_limit due events under a lease, resolving each one's
-- organisation from its customer. Due: received, held or failed with
-- next_attempt_at passed, or processing with an expired lease (the worker
-- died). Reclaiming an expired lease counts as an attempt, and one that has
-- used p_max_retries attempts is dead-lettered instead of claimed, so an
-- event that kills its worker every time cannot loop for ever. SKIP LOCKED
-- keeps concurrent ticks from claiming the same row.
create function claim_billing_events(
  p_limit integer,
  p_lease_seconds integer,
  p_max_retries integer
)
returns table (
  id uuid,
  external_event_id text,
  event_type text,
  stripe_customer_id text,
  organisation_id uuid,
  retry_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  update billing_event e
  set
    status = 'dead',
    retry_count = e.retry_count + 1,
    last_error_code = 'lease_expired',
    lease_expires_at = null,
    next_attempt_at = null,
    processed_at = now()
  where e.status = 'processing'
    and e.lease_expires_at <= now()
    and e.retry_count + 1 >= p_max_retries;

  return query
  with due as (
    select e.id
    from billing_event e
    where (
        e.status in ('received', 'held', 'failed')
        and coalesce(e.next_attempt_at, '-infinity'::timestamptz) <= now()
      )
      or (e.status = 'processing' and e.lease_expires_at <= now())
    order by coalesce(e.next_attempt_at, e.received_at), e.received_at, e.id
    limit greatest(least(p_limit, 100), 0)
    for update skip locked
  )
  update billing_event e
  set
    status = 'processing',
    retry_count = e.retry_count
      + case when e.status = 'processing' then 1 else 0 end,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    organisation_id = coalesce(
      e.organisation_id,
      (
        select b.organisation_id
        from organisation_billing b
        where b.stripe_customer_id = e.stripe_customer_id
      )
    )
  from due
  where e.id = due.id
  returning
    e.id,
    e.external_event_id,
    e.event_type,
    e.stripe_customer_id,
    e.organisation_id,
    e.retry_count;
end;
$$;

-- Settles an event the caller holds. Conditional on status = 'processing',
-- like settleWebhookEvent: a straggler whose lease was reclaimed returns
-- 'stale' and writes nothing. A failure that uses the last attempt is dead;
-- a hold never is.
create function settle_billing_event(
  p_id uuid,
  p_outcome text,
  p_error_code text,
  p_retry_delay_seconds integer,
  p_max_retries integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if p_outcome not in ('processed', 'held', 'failed') then
    raise exception 'unknown billing event outcome %', p_outcome
      using errcode = '22023';
  end if;

  update billing_event e
  set
    status = case
      when p_outcome = 'processed' then 'processed'
      when p_outcome = 'held' then 'held'
      when e.retry_count + 1 >= p_max_retries then 'dead'
      else 'failed'
    end,
    -- Failed and held attempts count; a processed one does not.
    retry_count = e.retry_count
      + case when p_outcome = 'processed' then 0 else 1 end,
    next_attempt_at = case
      when p_outcome = 'processed' then null
      when p_outcome = 'failed' and e.retry_count + 1 >= p_max_retries then null
      else now() + make_interval(secs => greatest(p_retry_delay_seconds, 1))
    end,
    processed_at = case
      when p_outcome = 'processed'
        or (p_outcome = 'failed' and e.retry_count + 1 >= p_max_retries)
      then now()
      else null
    end,
    last_error_code = case
      when p_outcome = 'processed' then null
      else left(p_error_code, 64)
    end,
    lease_expires_at = null
  where e.id = p_id
    and e.status = 'processing'
  returning e.status into v_status;

  return coalesce(v_status, 'stale');
end;
$$;

-- One page of the hourly reconciliation walk: the organisations with a
-- Stripe customer, in id order after p_after. Ids only; each organisation is
-- then reconciled inside its own tenant transaction.
create function billing_reconcile_page(p_after uuid, p_limit integer)
returns table (organisation_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select b.organisation_id
  from organisation_billing b
  where b.stripe_customer_id is not null
    and (p_after is null or b.organisation_id > p_after)
  order by b.organisation_id
  limit greatest(least(p_limit, 500), 0)
$$;

revoke all on function record_billing_event(
  text, text, boolean, text, text, text, timestamptz, boolean
) from public;
revoke all on function claim_billing_events(integer, integer, integer)
  from public;
revoke all on function settle_billing_event(uuid, text, text, integer, integer)
  from public;
revoke all on function billing_reconcile_page(uuid, integer) from public;

grant execute on function record_billing_event(
  text, text, boolean, text, text, text, timestamptz, boolean
) to naba_app_runtime;
grant execute on function claim_billing_events(integer, integer, integer)
  to naba_app_runtime;
grant execute on function settle_billing_event(uuid, text, text, integer, integer)
  to naba_app_runtime;
grant execute on function billing_reconcile_page(uuid, integer)
  to naba_app_runtime;

-- Converting a pilot closes its open calendar-month period at the moment of
-- conversion (owner-initiated: a pilot has no Stripe customer until its
-- owner starts checkout). That is the only change the runtime may make to a
-- period; allowances and windows of every other row stay as granted.
grant update (ends_at) on ai_credit_period to naba_app_runtime;

-- The hourly reconciliation tick's liveness row (lib/server/leases.ts) and
-- its cursor (lib/server/cron-cursor.ts).
insert into ops_heartbeat (name) values ('billing-reconcile')
on conflict (name) do nothing;
insert into cron_cursor (name) values ('billing')
on conflict (name) do nothing;

insert into schema_migration (version) values ('0225_billing_events')
on conflict (version) do nothing;

commit;
