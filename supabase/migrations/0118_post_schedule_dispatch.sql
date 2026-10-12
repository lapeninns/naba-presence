begin;

-- P08-R3: scheduled publication dispatch is strict.
--
--   * An approval freezes the Google target it was given for: the connection,
--     its credential generation and the Google location name, plus the
--     organisation's approval policy. A relink, reconnect or policy change
--     since then blocks the schedule instead of publishing through whatever
--     is linked now. `approved_security_version` (added with the approval
--     assurance columns by 0106) is what the runner rechecks the approver's
--     security version against; approval records it, nothing here sets it.
--   * Each occurrence carries the intent its publish runs under, so the
--     publish records a mutation_operation receipt, `mutation_recover`
--     covers an uncertain one, and the occurrence settles from that receipt.
--   * An occurrence may start only inside its 5-minute window (deadline_at,
--     0117). mark_missed_post_occurrences() runs every tick, even while
--     publishing is paused, and records a passed slot as missed: one whose
--     schedule was paused by a person is `paused_when_due`, any other is
--     `outside_dispatch_window`. A one-time schedule then needs a new time
--     (needs_review); nothing is ever published late.
--   * claim_due_publication_schedules() no longer claims an occurrence past
--     its deadline.
--
-- 0079 may already be applied with live rows, so every step works on
-- existing data and the whole file is safe to run again.

alter table post_publication_schedule add column if not exists target_google_connection_id uuid;
alter table post_publication_schedule add column if not exists target_credential_generation integer;
alter table post_publication_schedule add column if not exists target_google_location_name text;
alter table post_publication_schedule add column if not exists approved_approval_required boolean;
alter table post_publication_schedule add column if not exists approved_security_version integer;
alter table post_publication_schedule drop constraint if exists post_publication_schedule_target_generation_check;
alter table post_publication_schedule add constraint post_publication_schedule_target_generation_check
  check (target_credential_generation is null or target_credential_generation >= 1);
alter table post_publication_schedule drop constraint if exists post_publication_schedule_approved_security_version_check;
alter table post_publication_schedule add constraint post_publication_schedule_approved_security_version_check
  check (approved_security_version is null or approved_security_version >= 1);

-- A live approval from before this migration is pinned to the target the
-- runner would have used anyway: the location's current active link. One
-- with no usable link stays unpinned, and the runner blocks it for a fresh
-- approval rather than guessing (lib/server/publication-schedule-runner.ts).
update post_publication_schedule s
set target_google_connection_id = e.google_connection_id,
  target_credential_generation = gc.credential_generation,
  target_google_location_name = e.google_location_name
from location_link ll
join external_location e on e.id = ll.external_location_id
join google_connection gc on gc.id = e.google_connection_id
where ll.location_id = s.location_id
  and ll.is_active
  and e.google_location_name is not null
  and s.approved_revision = s.revision
  and s.status in ('active', 'paused', 'blocked')
  and s.target_google_connection_id is null;

update post_publication_schedule s
set approved_approval_required = o.approval_required
from organisation o
where o.id = s.organisation_id
  and s.approved_revision = s.revision
  and s.status in ('active', 'paused', 'blocked')
  and s.approved_approval_required is null;

alter table post_publication_occurrence add column if not exists intent_id uuid;
create unique index if not exists post_publication_occurrence_intent_idx
  on post_publication_occurrence (organisation_id, intent_id) where intent_id is not null;
-- Settling from receipts looks only at unresolved occurrences.
create index if not exists post_publication_occurrence_ambiguous_idx
  on post_publication_occurrence (organisation_id, intent_id) where status = 'ambiguous';
create index if not exists post_publication_occurrence_deadline_idx
  on post_publication_occurrence (deadline_at) where status = 'scheduled';

-- Every tick, across tenants and before the pause check: a scheduled
-- occurrence whose window has closed is missed. Returns what it marked, so
-- the runner can raise the schedule_missed events in each tenant.
create or replace function mark_missed_post_occurrences()
returns table (organisation_id uuid, schedule_id uuid, occurrence_id uuid, location_id uuid, intended_at timestamptz, reason text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_ids uuid[];
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
    returning o.id
  )
  select coalesce(array_agg(missed.id), '{}') into v_ids from missed;

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
  where o.id = any(v_ids);
end $$;
revoke all on function mark_missed_post_occurrences() from public;
grant execute on function mark_missed_post_occurrences() to naba_app_runtime;

-- Every tick, across tenants: an unresolved occurrence whose receipt has
-- since settled (the publish's own settle, or mutation_recover's readback)
-- takes the receipt's outcome. Nothing is sent: a write proven not to have
-- landed is recorded as failed and never retried here. A schedule blocked
-- only by unresolved occurrences resumes once none are left.
create or replace function settle_post_occurrences_from_receipts()
returns table (organisation_id uuid, schedule_id uuid, occurrence_id uuid, status text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_ids uuid[];
begin
  with settled as (
    update post_publication_occurrence o
    set status = case when m.state in ('confirmed_applied', 'awaiting_confirmation') then 'published' else 'rejected' end,
      status_reason = case m.state
        when 'confirmed_applied' then null
        when 'awaiting_confirmation' then null
        when 'rejected' then 'provider_rejected'
        else 'publish_failed' end,
      finished_at = now()
    from mutation_operation m
    where o.status = 'ambiguous'
      and o.intent_id is not null
      and m.organisation_id = o.organisation_id
      and m.intent_id = o.intent_id
      and m.state in ('confirmed_applied', 'awaiting_confirmation', 'rejected', 'failed')
    returning o.id
  )
  select coalesce(array_agg(settled.id), '{}') into v_ids from settled;

  if cardinality(v_ids) = 0 then
    return;
  end if;

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

-- 0079's claim, with one change: an occurrence is due only inside its
-- window (intended_at <= now() < deadline_at). One past it is left for
-- mark_missed_post_occurrences(), never claimed late.
create or replace function claim_due_publication_schedules(p_limit integer, p_lease_seconds integer, p_per_org integer)
returns table (organisation_id uuid, schedule_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  update post_publication_occurrence o set status = 'ambiguous', status_reason = 'execution_interrupted', finished_at = now()
  from post_publication_schedule s
  where o.schedule_id = s.id and o.status = 'publishing'
    and (s.claim_lease_expires_at is null or s.claim_lease_expires_at < now())
    and o.started_at < now() - make_interval(secs => p_lease_seconds);
  update post_publication_schedule s set status = 'blocked', status_reason = 'prior_occurrence_unresolved', updated_at = now()
  where s.status = 'active' and exists (
    select 1 from post_publication_occurrence o where o.schedule_id = s.id and o.status = 'ambiguous');
  return query
  with due as (
    select s.id, s.organisation_id, min(o.intended_at) as due_at
    from post_publication_schedule s
    join post_publication_occurrence o on o.schedule_id = s.id and o.schedule_revision = s.revision and o.status = 'scheduled'
    where s.status = 'active' and o.intended_at <= now() and o.deadline_at > now()
      and (s.claim_lease_expires_at is null or s.claim_lease_expires_at < now())
    group by s.id, s.organisation_id
  ), ranked as (
    select due.*, row_number() over (partition by due.organisation_id order by due.due_at, due.id) as rn from due
  ), chosen as (
    select id from ranked where rn <= p_per_org order by due_at, id limit p_limit
  )
  update post_publication_schedule s set claim_lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  from chosen where s.id = chosen.id
  returning s.organisation_id, s.id;
end $$;
revoke all on function claim_due_publication_schedules(integer, integer, integer) from public;
grant execute on function claim_due_publication_schedules(integer, integer, integer) to naba_app_runtime;

insert into schema_migration(version) values ('0118_post_schedule_dispatch') on conflict (version) do nothing;
commit;
