begin;

-- P08-R3 review fixes: the sweep functions from 0242, redefined.
--
--   * mark_missed_post_occurrences() still marks every passed slot missed,
--     but returns (for a schedule_missed event) only those of an active or
--     paused schedule. A blocked repeating schedule raised a new incident,
--     with an immediate email, every day it stayed blocked.
--   * settle_post_occurrences_from_receipts() reads only the occurrence's own
--     receipt (local_post, its own post): the intent is derived from the
--     occurrence id, which members can see, so another write may have taken
--     it. A publish refused for lateness (schedule_deadline_passed) settles
--     missed, as the runner settles it. An interrupted publish that recorded
--     no receipt was never sent and, once its window has closed, cannot be:
--     it settles missed instead of staying unresolved for good. An
--     unresolved occurrence from before 0242 (no intent) settles from its
--     post, or goes to review when its post proves nothing either way.
--
-- Functions only: no table or data changes, and safe to run again.

-- Every tick, across tenants and before the pause check: a scheduled
-- occurrence whose window has closed is missed. Returns the ones to raise a
-- schedule_missed event for, so the runner can raise them in each tenant:
-- only those of an active or paused schedule. A blocked schedule already
-- raised schedule_blocked, and a repeating one would otherwise raise a fresh
-- incident (with an immediate email) for every day it stays blocked.
create or replace function mark_missed_post_occurrences()
returns table (organisation_id uuid, schedule_id uuid, occurrence_id uuid, location_id uuid, intended_at timestamptz, reason text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_ids uuid[];
  v_notify uuid[];
begin
  with missed as (
    update post_publication_occurrence o
    set status = 'missed',
      status_reason = case when s.status = 'paused' then 'paused_when_due' else 'outside_dispatch_window' end,
      finished_at = now()
    from post_publication_schedule s
    where o.schedule_id = s.id
      and o.status = 'scheduled'
      and o.deadline_at <= now()
    returning o.id, s.status as schedule_status
  )
  select coalesce(array_agg(missed.id), '{}'),
    coalesce(array_agg(missed.id) filter (where missed.schedule_status in ('active', 'paused')), '{}')
  into v_ids, v_notify from missed;

  if cardinality(v_ids) = 0 then
    return;
  end if;

  -- A one-time schedule whose slot passed needs a new time. A blocked one
  -- keeps its own reason: resubmitting it also needs a new time.
  update post_publication_schedule s
  set status = 'needs_review', status_reason = o.status_reason, updated_at = now()
  from post_publication_occurrence o
  where o.id = any(v_ids)
    and o.schedule_id = s.id
    and o.schedule_revision = s.revision
    and s.rule ->> 'frequency' = 'once'
    and s.status in ('active', 'paused');

  -- A repeating schedule with nothing left to run is complete, as the
  -- runner's finish step would have made it.
  update post_publication_schedule s
  set status = 'completed', updated_at = now()
  where s.status = 'active'
    and s.rule ->> 'frequency' <> 'once'
    and s.id in (select o.schedule_id from post_publication_occurrence o where o.id = any(v_ids))
    and not exists (
      select 1 from post_publication_occurrence o
      where o.schedule_id = s.id and o.schedule_revision = s.revision
        and o.status in ('scheduled', 'publishing', 'ambiguous'));

  return query
  select o.organisation_id, o.schedule_id, o.id, o.location_id, o.intended_at, o.status_reason
  from post_publication_occurrence o
  where o.id = any(v_notify);
end $$;
revoke all on function mark_missed_post_occurrences() from public;
grant execute on function mark_missed_post_occurrences() to naba_app_runtime;

-- Every tick, across tenants: settles unresolved (ambiguous) occurrences.
-- Nothing is ever sent from here.
--
--   1. One with its own receipt (recorded under its intent, for the
--      local_post surface and its own post; any other write that took the
--      intent is not its receipt) takes the receipt's outcome once the
--      receipt has one: published, rejected (provider_rejected or
--      publish_failed) or, for a publish refused for lateness
--      (schedule_deadline_passed), missed, exactly as the runner settles it.
--   2. One with no receipt of its own was never sent: the receipt is
--      recorded before the provider call. Once its window has closed (plus a
--      minute for clock skew) no send can start either, because the publish
--      refuses at its deadline immediately before the provider call. It is
--      missed (outside_dispatch_window).
--   3. One from before 0242 (no intent) settles from its post: published or
--      failed. Any other post state cannot be proven either way, so the
--      occurrence stops being tracked (cancelled / outcome_unverified) and
--      its schedule goes to review (prior_occurrence_unverified) for a
--      person to check Google.
--
-- Then: a one-time schedule whose slot settled missed needs a new time
-- (needs_review), and a schedule blocked only by unresolved occurrences
-- resumes, or completes when nothing is left.
create or replace function settle_post_occurrences_from_receipts()
returns table (organisation_id uuid, schedule_id uuid, occurrence_id uuid, status text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_receipt uuid[];
  v_unsent uuid[];
  v_legacy uuid[];
  v_ids uuid[];
begin
  with settled as (
    update post_publication_occurrence o
    set status = case
        when m.state in ('confirmed_applied', 'awaiting_confirmation') then 'published'
        when m.state = 'failed' and m.error_code = 'schedule_deadline_passed' then 'missed'
        else 'rejected' end,
      status_reason = case
        when m.state in ('confirmed_applied', 'awaiting_confirmation') then null
        when m.state = 'rejected' then 'provider_rejected'
        when m.error_code = 'schedule_deadline_passed' then 'outside_dispatch_window'
        else 'publish_failed' end,
      finished_at = now()
    from mutation_operation m
    where o.status = 'ambiguous'
      and o.intent_id is not null
      and m.organisation_id = o.organisation_id
      and m.intent_id = o.intent_id
      and m.surface = 'local_post'
      and m.target_ref = o.post_id::text
      and m.state in ('confirmed_applied', 'awaiting_confirmation', 'rejected', 'failed')
    returning o.id
  )
  select coalesce(array_agg(settled.id), '{}') into v_receipt from settled;

  with unsent as (
    update post_publication_occurrence o
    set status = 'missed', status_reason = 'outside_dispatch_window', finished_at = now()
    where o.status = 'ambiguous'
      and o.intent_id is not null
      and o.deadline_at + interval '1 minute' <= now()
      and not exists (
        select 1 from mutation_operation m
        where m.organisation_id = o.organisation_id
          and m.intent_id = o.intent_id
          and m.surface = 'local_post'
          and m.target_ref = o.post_id::text)
    returning o.id
  )
  select coalesce(array_agg(unsent.id), '{}') into v_unsent from unsent;

  with legacy as (
    update post_publication_occurrence o
    set status = case l.post_status when 'published' then 'published' when 'failed' then 'rejected' else 'cancelled' end,
      status_reason = case l.post_status when 'published' then null when 'failed' then 'publish_failed' else 'outcome_unverified' end,
      finished_at = now()
    from (
      select x.id, p.status as post_status
      from post_publication_occurrence x
      left join gbp_local_post p on p.id = x.post_id
      where x.status = 'ambiguous' and x.intent_id is null
    ) l
    where o.id = l.id
    returning o.id
  )
  select coalesce(array_agg(legacy.id), '{}') into v_legacy from legacy;

  v_ids := v_receipt || v_unsent || v_legacy;
  if cardinality(v_ids) = 0 then
    return;
  end if;

  -- An earlier publication nobody can prove either way: a person checks
  -- Google before the schedule runs again.
  update post_publication_schedule s
  set status = 'needs_review', status_reason = 'prior_occurrence_unverified', updated_at = now()
  where s.id in (
      select o.schedule_id from post_publication_occurrence o
      where o.id = any(v_legacy) and o.status = 'cancelled')
    and (s.status in ('active', 'paused')
      or (s.status = 'blocked' and s.status_reason = 'prior_occurrence_unresolved'));

  -- A one-time slot that settled missed needs a new time, as
  -- mark_missed_post_occurrences() and the runner do.
  update post_publication_schedule s
  set status = 'needs_review', status_reason = o.status_reason, updated_at = now()
  from post_publication_occurrence o
  where o.id = any(v_ids)
    and o.status = 'missed'
    and o.schedule_id = s.id
    and o.schedule_revision = s.revision
    and s.rule ->> 'frequency' = 'once'
    and (s.status in ('active', 'paused')
      or (s.status = 'blocked' and s.status_reason = 'prior_occurrence_unresolved'));

  update post_publication_schedule s
  set status = case when exists (
        select 1 from post_publication_occurrence o
        where o.schedule_id = s.id and o.schedule_revision = s.revision and o.status = 'scheduled'
      ) then 'active' else 'completed' end,
    status_reason = null,
    updated_at = now()
  where s.status = 'blocked'
    and s.status_reason = 'prior_occurrence_unresolved'
    and s.approved_revision = s.revision
    and s.id in (select o.schedule_id from post_publication_occurrence o where o.id = any(v_ids))
    and not exists (
      select 1 from post_publication_occurrence o
      where o.schedule_id = s.id and o.status in ('ambiguous', 'publishing'));

  return query
  select o.organisation_id, o.schedule_id, o.id, o.status
  from post_publication_occurrence o
  where o.id = any(v_ids);
end $$;
revoke all on function settle_post_occurrences_from_receipts() from public;
grant execute on function settle_post_occurrences_from_receipts() to naba_app_runtime;

insert into schema_migration(version) values ('0243_post_schedule_settle') on conflict (version) do nothing;
commit;
