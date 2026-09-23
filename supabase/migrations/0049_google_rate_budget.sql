begin;

-- ---------------------------------------------------------------------------
-- One Google request budget for every instance.
--
-- Pacing used to live in each process's memory, and cron ticks, webhook
-- handling and interactive requests all run in separate Vercel functions, so
-- none of them saw the others: together they could exceed Business Profile's
-- 300 requests per minute per API, or its 10 edits per minute per profile
-- (which cannot be raised).
--
-- google_rate_bucket is platform-level, like ops_heartbeat: bucket names are
-- API hosts ("mybusiness.googleapis.com") and per-location edit buckets
-- ("edit:locations/123"); no tenant data. Each row is a fixed window counter.
-- The caller sizes the window (10 seconds) and its capacity (a sixth of the
-- per-minute limit) so that any rolling minute, which spans at most seven
-- windows, stays under the limit: 7 x floor(240/6) = 280 < 300, and
-- 7 x 1 = 7 < 10 edits.
--
-- blocked_until is the cross-instance Retry-After: one instance hearing 429
-- stops them all for the time Google asked.
-- ---------------------------------------------------------------------------

create table google_rate_bucket (
  bucket text primary key,
  window_started_at timestamptz not null default now(),
  used integer not null default 0,
  blocked_until timestamptz,
  throttled_count integer not null default 0,
  last_throttled_at timestamptz,
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on google_rate_bucket to naba_app_runtime;

-- Returns 0 when a request may go now, otherwise how many milliseconds until
-- the bucket has room. Row-locked, so concurrent callers serialise on the
-- bucket and never both take its last slot.
create or replace function take_google_rate_budget(
  p_bucket text,
  p_capacity integer,
  p_window_seconds integer
)
returns integer
language plpgsql
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row google_rate_bucket%rowtype;
  v_window interval := make_interval(secs => p_window_seconds);
begin
  insert into google_rate_bucket (bucket, window_started_at, used)
  values (p_bucket, v_now, 0)
  on conflict (bucket) do nothing;

  select * into v_row
  from google_rate_bucket
  where bucket = p_bucket
  for update;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    return ceil(extract(epoch from (v_row.blocked_until - v_now)) * 1000)::integer;
  end if;

  if v_row.window_started_at + v_window <= v_now then
    update google_rate_bucket
    set window_started_at = v_now, used = 1, updated_at = v_now
    where bucket = p_bucket;
    return 0;
  end if;

  if v_row.used < p_capacity then
    update google_rate_bucket
    set used = used + 1, updated_at = v_now
    where bucket = p_bucket;
    return 0;
  end if;

  return greatest(
    1,
    ceil(extract(epoch from (v_row.window_started_at + v_window - v_now)) * 1000)::integer
  );
end;
$$;

-- Google answered 429: hold the bucket for everyone until Retry-After.
create or replace function record_google_throttle(
  p_bucket text,
  p_retry_after_ms integer
)
returns void
language sql
as $$
  insert into google_rate_bucket (
    bucket, window_started_at, used, blocked_until, throttled_count,
    last_throttled_at, updated_at
  )
  values (
    p_bucket, now(), 0,
    now() + make_interval(secs => p_retry_after_ms / 1000.0),
    1, now(), now()
  )
  on conflict (bucket) do update
  set
    blocked_until = greatest(
      coalesce(google_rate_bucket.blocked_until, now()),
      now() + make_interval(secs => p_retry_after_ms / 1000.0)
    ),
    throttled_count = google_rate_bucket.throttled_count + 1,
    last_throttled_at = now(),
    updated_at = now()
$$;

grant execute on function take_google_rate_budget(text, integer, integer)
  to naba_app_runtime;
grant execute on function record_google_throttle(text, integer)
  to naba_app_runtime;

insert into schema_migration (version) values ('0049_google_rate_budget')
on conflict (version) do nothing;

commit;
