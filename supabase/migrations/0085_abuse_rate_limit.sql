begin;

-- ---------------------------------------------------------------------------
-- Application abuse limits, shared by every instance (ledger SEC-07, SEC-08).
--
-- Each row is one fixed-window counter: how many times a key (a hashed client
-- IP, email address, user or token, never the plaintext; lib/server/
-- abuse-limits.ts) hit a scope (login, register, invitation_lookup, ...) in
-- the window that starts at window_start. Windows are aligned to multiples of
-- their length, so every instance computes the same window_start for the same
-- moment and the primary key alone serialises concurrent hits.
--
-- Platform-level like google_rate_bucket (0049): no organisation, no tenant
-- data. Unlike that table the runtime role cannot touch the rows: it holds
-- select only (so the grant contract holds), and RLS is on with no policies,
-- so even that sees nothing. The only ways in are the two SECURITY DEFINER
-- functions below. A compromised request path can count a hit or purge ended
-- windows, but cannot read which keys are being counted or reset a bucket
-- early.
--
-- expires_at is stored rather than derived because the window length is the
-- caller's choice per scope; the retention cron purges on it.
-- ---------------------------------------------------------------------------

create table abuse_rate_bucket (
  scope text not null check (scope ~ '^[a-z][a-z0-9_]{0,63}$'),
  key_hash text not null check (length(key_hash) between 16 and 128),
  window_start timestamptz not null,
  expires_at timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (scope, key_hash, window_start)
);

create index abuse_rate_bucket_expires_at_idx on abuse_rate_bucket (expires_at);

alter table abuse_rate_bucket enable row level security;
revoke all on abuse_rate_bucket from public;
grant select on abuse_rate_bucket to naba_app_runtime;

-- Counts one hit and answers whether it fits under p_limit. The upsert takes
-- the row lock, so concurrent callers on the same key are counted exactly
-- once each and at most p_limit of them are allowed per window. A refused
-- hit is still counted: retrying while limited does not reopen the window
-- early, it only keeps the count above the limit until the window ends.
create or replace function take_abuse_budget(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_epoch double precision := extract(epoch from v_now);
  v_window_start timestamptz;
  v_expires_at timestamptz;
  v_hits integer;
begin
  if p_limit is null or p_limit < 1 then
    raise exception 'take_abuse_budget: limit must be positive'
      using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds < 1
    or p_window_seconds > 86400 then
    raise exception 'take_abuse_budget: window must be 1 to 86400 seconds'
      using errcode = '22023';
  end if;

  v_window_start := to_timestamp(
    floor(v_epoch / p_window_seconds) * p_window_seconds
  );
  v_expires_at := v_window_start + make_interval(secs => p_window_seconds);

  insert into abuse_rate_bucket as b (
    scope, key_hash, window_start, expires_at, hits
  )
  values (p_scope, p_key_hash, v_window_start, v_expires_at, 1)
  on conflict (scope, key_hash, window_start) do update
  set hits = b.hits + 1
  returning b.hits into v_hits;

  allowed := v_hits <= p_limit;
  retry_after_seconds := case
    when v_hits <= p_limit then 0
    else greatest(1, ceil(extract(epoch from (v_expires_at - v_now)))::integer)
  end;
  return next;
end;
$$;

-- Deletes up to p_limit windows that have ended, oldest first; the retention
-- cron calls it until it returns less than its batch.
create or replace function purge_abuse_rate_buckets(p_limit integer)
returns integer
language sql
security definer
set search_path = public
as $$
  with expired as (
    select scope, key_hash, window_start
    from abuse_rate_bucket
    where expires_at <= now()
    order by expires_at
    limit greatest(coalesce(p_limit, 0), 0)
  ),
  removed as (
    delete from abuse_rate_bucket b
    using expired e
    where b.scope = e.scope
      and b.key_hash = e.key_hash
      and b.window_start = e.window_start
    returning 1
  )
  select count(*)::integer from removed
$$;

revoke all on function take_abuse_budget(text, text, integer, integer)
  from public;
revoke all on function purge_abuse_rate_buckets(integer) from public;
grant execute on function take_abuse_budget(text, text, integer, integer)
  to naba_app_runtime;
grant execute on function purge_abuse_rate_buckets(integer)
  to naba_app_runtime;

insert into schema_migration (version) values ('0085_abuse_rate_limit')
on conflict (version) do nothing;

commit;
