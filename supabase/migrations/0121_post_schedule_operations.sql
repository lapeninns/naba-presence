begin;

-- P08-R6: operating scheduled post publication.
--
--   * Two operator alerts (platform_incident kinds), one incident per
--     organisation, opened by the health tick from post_schedule_health():
--       scheduled_post_stuck    an occurrence still `publishing` after its
--                               schedule's lease ran out, well past the point
--                               the claim's reaper would have made it
--                               `ambiguous` (the jobs tick or its scheduled
--                               post path is not running);
--       scheduled_post_overdue  an occurrence still `scheduled` more than a
--                               minute past its deadline, which the every-tick
--                               sweep (mark_missed_post_occurrences) would
--                               have recorded missed.
--     Neither ever publishes, resends or settles anything: they only report.
--   * Retention: purge_post_schedule_history() deletes, in the caller's
--     tenant only, history that has aged past the retention period: ended
--     occurrences (published, rejected, missed, cancelled), ended schedules
--     (cancelled, completed) with no live or recent occurrence left, and old
--     per-post times an owner dismissed. Anything still open is kept however
--     old: an `ambiguous` occurrence waiting on its receipt, a schedule in
--     review or awaiting approval, an old per-post time nobody reviewed yet.
--     The runtime role gets no DELETE on these tables; only this function.
--
-- Functions, an index and a widened check only: no rows change, nothing is
-- created or sent, and the file is safe to run again.

-- The union of every kind before this file: 0089's tick findings and 0098's
-- tick_cycle_failures (retention cycle), plus the two scheduled post kinds.
-- A later file that widens the check again must keep all of them.
alter table platform_incident
  drop constraint if exists platform_incident_kind_check;
alter table platform_incident
  add constraint platform_incident_kind_check check (
    kind in (
      'stale_heartbeat',
      'google_quota_pressure',
      'tick_never_completed',
      'tick_lock_wedged',
      'tick_cycle_overdue',
      'tick_cycle_failures',
      'scheduled_post_stuck',
      'scheduled_post_overdue'
    )
  );

-- Platform-level, across tenants like the sweep functions: counts and the
-- oldest instants per organisation, nothing from a post. At most 500
-- organisations are reported per call.
create or replace function post_schedule_health(p_stuck_after_seconds integer, p_overdue_after_seconds integer)
returns table (
  organisation_id uuid,
  stuck_publishing integer,
  oldest_started_at timestamptz,
  overdue_scheduled integer,
  oldest_deadline_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with flagged as (
    select o.organisation_id as org,
      (o.status = 'publishing'
        and o.started_at <= now() - make_interval(secs => p_stuck_after_seconds)
        and (s.claim_lease_expires_at is null or s.claim_lease_expires_at <= now())) as stuck,
      (o.status = 'scheduled'
        and o.deadline_at <= now() - make_interval(secs => p_overdue_after_seconds)) as overdue,
      o.started_at as started,
      o.deadline_at as deadline
    from post_publication_occurrence o
    join post_publication_schedule s on s.id = o.schedule_id
    where o.status = 'publishing'
      or (o.status = 'scheduled' and o.deadline_at <= now() - make_interval(secs => p_overdue_after_seconds))
  )
  select org,
    (count(*) filter (where stuck))::integer,
    min(started) filter (where stuck),
    (count(*) filter (where overdue))::integer,
    min(deadline) filter (where overdue)
  from flagged
  where stuck or overdue
  group by org
  order by org
  limit 500
$$;
revoke all on function post_schedule_health(integer, integer) from public;
grant execute on function post_schedule_health(integer, integer) to naba_app_runtime;

-- Ended occurrences age off by when they ended.
create index if not exists post_publication_occurrence_ended_idx
  on post_publication_occurrence (organisation_id, finished_at)
  where status in ('published', 'rejected', 'missed', 'cancelled');

-- Retention, inside the caller's tenant (app.organisation_id, set by
-- withTenant). Refuses without a tenant and below 30 days, so a mistaken
-- call cannot empty the history.
create or replace function purge_post_schedule_history(p_retention_days integer)
returns table (occurrences integer, schedules integer, legacy_schedules integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_org uuid := nullif(current_setting('app.organisation_id', true), '')::uuid;
  v_cutoff timestamptz;
  v_occurrences integer;
  v_schedules integer;
  v_legacy integer;
begin
  if v_org is null then
    raise exception 'purge_post_schedule_history needs a tenant' using errcode = '42501';
  end if;
  if p_retention_days is null or p_retention_days < 30 then
    raise exception 'purge_post_schedule_history keeps at least 30 days' using errcode = '22023';
  end if;
  v_cutoff := now() - make_interval(days => p_retention_days);

  with gone as (
    delete from post_publication_occurrence o
    where o.organisation_id = v_org
      and o.status in ('published', 'rejected', 'missed', 'cancelled')
      and coalesce(o.finished_at, o.created_at) <= v_cutoff
    returning o.id
  )
  select count(*)::integer into v_occurrences from gone;

  -- An ended schedule goes once nothing of it is live or recent; its
  -- remaining occurrences (none, or only aged ones) cascade with it.
  with gone as (
    delete from post_publication_schedule s
    where s.organisation_id = v_org
      and s.status in ('cancelled', 'completed')
      and s.updated_at <= v_cutoff
      and not exists (
        select 1 from post_publication_occurrence o
        where o.schedule_id = s.id
          and (o.status in ('scheduled', 'publishing', 'ambiguous')
            or coalesce(o.finished_at, o.created_at) > v_cutoff))
    returning s.id
  )
  select count(*)::integer into v_schedules from gone;

  with gone as (
    delete from gbp_local_post_legacy_schedule l
    where l.organisation_id = v_org
      and l.status = 'dismissed'
      and l.reviewed_at <= v_cutoff
    returning l.id
  )
  select count(*)::integer into v_legacy from gone;

  return query select v_occurrences, v_schedules, v_legacy;
end $$;
revoke all on function purge_post_schedule_history(integer) from public;
grant execute on function purge_post_schedule_history(integer) to naba_app_runtime;

insert into schema_migration (version) values ('0121_post_schedule_operations') on conflict (version) do nothing;
commit;
