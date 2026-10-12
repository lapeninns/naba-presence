begin;

-- P08-R6 review fixes to 0245's two functions. Functions only: no rows
-- change, nothing is created or sent, and the file is safe to run again.
--
--   * post_schedule_health() reports every affected organisation. 0245
--     stopped at 500, and the health tick resolves any open scheduled post
--     incident whose organisation is not in the result, so an organisation
--     past the 500th would have had its incident resolved while the condition
--     still held. The result is one row per organisation, so it stays small.
--   * purge_post_schedule_history() keeps every occurrence of a schedule that
--     is in review or blocked, however old. The occurrence names the post and
--     slot the person must check on Google (an `outcome_unverified`
--     cancellation behind `prior_occurrence_unverified`, a missed one-time
--     slot waiting for a new time), so it stays while that review is open.

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
$$;
revoke all on function post_schedule_health(integer, integer) from public;
grant execute on function post_schedule_health(integer, integer) to naba_app_runtime;

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

  -- An ended occurrence goes once aged, unless its schedule is in review or
  -- blocked: then it is what the person must check, and stays.
  with gone as (
    delete from post_publication_occurrence o
    where o.organisation_id = v_org
      and o.status in ('published', 'rejected', 'missed', 'cancelled')
      and coalesce(o.finished_at, o.created_at) <= v_cutoff
      and not exists (
        select 1 from post_publication_schedule s
        where s.id = o.schedule_id
          and s.status in ('needs_review', 'blocked'))
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

insert into schema_migration (version) values ('0246_post_schedule_operations_review') on conflict (version) do nothing;
commit;
