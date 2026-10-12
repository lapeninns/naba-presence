begin;

-- P08-R1: one-time publication is the generally available scheduling
-- frequency. Repeating schedules move behind the organisation feature
-- `post_scheduling_recurring` (default off), so every repeating schedule that
-- could still run is quarantined for an owner's review instead of running
-- under rules nobody approved for it. Nothing is deleted and no job is
-- created: a quarantined schedule keeps its rule, template, approval history
-- and published occurrences, and an owner revises (fresh approval) or
-- cancels it.
--
-- 0079 may already be applied with live rows, so every step works on
-- existing data and the whole file is safe to run again (a no-op the second
-- time).

alter table post_publication_schedule drop constraint if exists post_publication_schedule_status_check;
alter table post_publication_schedule add constraint post_publication_schedule_status_check check (status in (
  'awaiting_approval', 'active', 'paused', 'blocked', 'needs_review', 'cancelled', 'completed'
));

-- Not-yet-run occurrences of a quarantined schedule are cancelled first, so
-- the runner's claim (active schedules only) never sees them again. One
-- already publishing is left to settle from its own outcome.
update post_publication_occurrence o
set status = 'cancelled', status_reason = 'schedule_quarantined', finished_at = now()
from post_publication_schedule s
where o.schedule_id = s.id
  and o.status = 'scheduled'
  and s.rule ->> 'frequency' <> 'once'
  and s.status in ('awaiting_approval', 'active', 'paused', 'blocked');

update post_publication_schedule
set status = 'needs_review', status_reason = 'recurring_quarantined', updated_at = now()
where rule ->> 'frequency' <> 'once'
  and status in ('awaiting_approval', 'active', 'paused', 'blocked');

-- The pre-WP7 per-post schedule columns. Nothing ever published a post when
-- its time arrived (see lib/contracts/location-posts.ts), and nothing reads
-- them now; a value left on an unpublished post is copied here for an owner
-- to review or dismiss rather than silently ignored or turned into a job.
create table if not exists gbp_local_post_legacy_schedule (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  post_id uuid not null references gbp_local_post(id) on delete cascade,
  scheduled_publish_time timestamptz,
  recurrence jsonb,
  status text not null default 'needs_review' check (status in ('needs_review', 'dismissed')),
  reviewed_by uuid references app_user(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (post_id),
  check (scheduled_publish_time is not null or recurrence is not null),
  check ((status = 'dismissed') = (reviewed_at is not null))
);
create index if not exists gbp_local_post_legacy_schedule_review_idx
  on gbp_local_post_legacy_schedule (organisation_id, location_id)
  where status = 'needs_review';

alter table gbp_local_post_legacy_schedule enable row level security;
alter table gbp_local_post_legacy_schedule force row level security;
drop policy if exists tenant_isolation on gbp_local_post_legacy_schedule;
create policy tenant_isolation on gbp_local_post_legacy_schedule
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
-- Filled here only; the runtime reads it and may change only the review
-- columns (an owner's dismissal), never the post, location or values.
revoke all on gbp_local_post_legacy_schedule from public, naba_app_runtime;
grant select on gbp_local_post_legacy_schedule to naba_app_runtime;
grant update (status, reviewed_by, reviewed_at) on gbp_local_post_legacy_schedule to naba_app_runtime;

insert into gbp_local_post_legacy_schedule (organisation_id, location_id, post_id, scheduled_publish_time, recurrence)
select p.organisation_id, p.location_id, p.id, p.scheduled_publish_time, nullif(p.recurrence, 'null'::jsonb)
from gbp_local_post p
where p.status not in ('published', 'deleted')
  and (p.scheduled_publish_time is not null or nullif(p.recurrence, 'null'::jsonb) is not null)
on conflict (post_id) do nothing;

comment on column gbp_local_post.scheduled_publish_time is
  'Deprecated (P08-R1): never read or written. Unpublished values were copied to gbp_local_post_legacy_schedule for review.';
comment on column gbp_local_post.recurrence is
  'Deprecated (P08-R1): never read or written. Unpublished values were copied to gbp_local_post_legacy_schedule for review.';

insert into schema_migration (version) values ('0116_post_schedule_quarantine') on conflict (version) do nothing;
commit;
