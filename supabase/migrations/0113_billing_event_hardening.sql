begin;

-- ---------------------------------------------------------------------------
-- 0113: billing event hardening (plan P07-S4 review fixes).
--
-- 1. A hold no longer counts as an attempt. Before this, settling an event
--    as 'held' added one to retry_count, so an event held for a few hours
--    (customer not linked yet) reached its first real failure with no retry
--    budget left and went straight to 'dead'. retry_count now counts only
--    failures and expired leases, the things the dead-letter is for.
-- 2. A held event ends. One that can never resolve an organisation (no
--    customer id) or that has been held for HELD_MAX_AGE (7 days) settles as
--    'ignored' with last_error_code 'customer_unknown' instead of being held
--    again, so the held backlog is bounded. The hourly reconciliation still
--    covers any organisation linked later. A handled event recorded without
--    a customer id is 'ignored' from the start.
-- 3. A claimed event the worker did not get to (its budget ran out) can be
--    handed back: outcome 'released' returns it to 'received', due now,
--    without counting an attempt.
-- 4. The runtime's update (ends_at) on ai_credit_period may only shorten a
--    pilot month (closing it when the pilot converts). Extending a period,
--    or touching the window of a trial, paid period or adjustment, raises
--    23514 'ai_credit_period_window_fixed'.
-- ---------------------------------------------------------------------------

set local lock_timeout = '5s';

create or replace function record_billing_event(
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
  -- Without a customer the event can never be routed to an organisation.
  v_actionable boolean := p_handled and p_stripe_customer_id is not null;
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
    processed_at,
    last_error_code
  )
  values (
    p_external_event_id,
    p_event_type,
    p_livemode,
    p_account_id,
    p_stripe_customer_id,
    p_payload_hash,
    p_event_created_at,
    case when v_actionable then 'received' else 'ignored' end,
    case when v_actionable then now() else null end,
    case when v_actionable then null else now() end,
    case
      when p_handled and p_stripe_customer_id is null then 'customer_missing'
      else null
    end
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

-- Settles an event the caller holds. Conditional on status = 'processing':
-- a straggler whose lease was reclaimed returns 'stale' and writes nothing.
--   processed  applied;
--   failed     counts an attempt; the last one is dead;
--   held       no organisation has the customer yet; does not count an
--              attempt; ends as 'ignored' when it can never resolve (no
--              customer id) or has been held for 7 days;
--   released   not attempted (the worker's budget ran out); back to
--              'received', due now, no attempt counted.
create or replace function settle_billing_event(
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
  if p_outcome not in ('processed', 'held', 'failed', 'released') then
    raise exception 'unknown billing event outcome %', p_outcome
      using errcode = '22023';
  end if;

  with target as (
    select
      e.id,
      case
        when p_outcome = 'processed' then 'processed'
        when p_outcome = 'released' then 'received'
        when p_outcome = 'held'
          and (
            e.stripe_customer_id is null
            or e.received_at <= now() - interval '7 days'
          )
        then 'ignored'
        when p_outcome = 'held' then 'held'
        when e.retry_count + 1 >= p_max_retries then 'dead'
        else 'failed'
      end as next_status
    from billing_event e
    where e.id = p_id
      and e.status = 'processing'
    for update
  )
  update billing_event e
  set
    status = t.next_status,
    -- Only a failure counts; holds and releases are not attempts.
    retry_count = e.retry_count
      + case when t.next_status in ('failed', 'dead') then 1 else 0 end,
    next_attempt_at = case
      when t.next_status in ('processed', 'ignored', 'dead') then null
      when t.next_status = 'received' then now()
      else now() + make_interval(secs => greatest(p_retry_delay_seconds, 1))
    end,
    processed_at = case
      when t.next_status in ('processed', 'ignored', 'dead') then now()
      else null
    end,
    last_error_code = case
      when t.next_status = 'processed' then null
      when t.next_status = 'received' then e.last_error_code
      else left(p_error_code, 64)
    end,
    lease_expires_at = null
  from target t
  where e.id = t.id
  returning e.status into v_status;

  return coalesce(v_status, 'stale');
end;
$$;

revoke all on function record_billing_event(
  text, text, boolean, text, text, text, timestamptz, boolean
) from public;
revoke all on function settle_billing_event(uuid, text, text, integer, integer)
  from public;
grant execute on function record_billing_event(
  text, text, boolean, text, text, text, timestamptz, boolean
) to naba_app_runtime;
grant execute on function settle_billing_event(uuid, text, text, integer, integer)
  to naba_app_runtime;

-- A credit period's end is fixed once granted, except that a pilot month may
-- be shortened (closed when its organisation converts). Every role is held
-- to it; the runtime's column grant (0112) reaches nothing but ends_at.
create function ai_credit_period_window_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.ends_at is distinct from old.ends_at
    and not (
      old.kind = 'pilot_month'
      and new.kind = 'pilot_month'
      and new.ends_at <= old.ends_at
    )
  then
    raise exception 'ai_credit_period_window_fixed' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function ai_credit_period_window_guard() from public;

create trigger ai_credit_period_window_guard
before update of ends_at on ai_credit_period
for each row execute function ai_credit_period_window_guard();

insert into schema_migration (version) values ('0113_billing_event_hardening')
on conflict (version) do nothing;

commit;
