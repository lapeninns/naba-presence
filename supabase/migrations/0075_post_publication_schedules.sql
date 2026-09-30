begin;

-- WP7: scheduled and recurring post publication, separate from a post's own
-- Google event recurrence. Existing posts are untouched: nothing here creates
-- a pending publication.

create table post_publication_schedule (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  source_post_id uuid references gbp_local_post(id) on delete set null,
  -- The frozen post content every occurrence publishes.
  template jsonb not null,
  -- Explicit event dates relative to each occurrence, for repeating events/offers.
  event_offsets jsonb,
  rule jsonb not null,
  timezone text not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  revision integer not null default 1 check (revision > 0),
  status text not null default 'awaiting_approval' check (status in (
    'awaiting_approval', 'active', 'paused', 'blocked', 'cancelled', 'completed'
  )),
  status_reason text,
  requested_by uuid not null references app_user(id) on delete restrict,
  approved_by uuid references app_user(id) on delete restrict,
  approved_at timestamptz,
  approved_revision integer,
  require_two_person_approval boolean not null,
  claim_lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((approved_by is null) = (approved_revision is null)),
  check (status not in ('active', 'paused') or approved_revision = revision)
);
create index post_publication_schedule_location_idx on post_publication_schedule (organisation_id, location_id, status);
create index post_publication_schedule_active_idx on post_publication_schedule (status) where status = 'active';

-- One row per schedule, revision and intended UTC instant: a duplicate cron
-- call or a restarted worker cannot create a second intended occurrence.
create table post_publication_occurrence (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  schedule_id uuid not null references post_publication_schedule(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  schedule_revision integer not null,
  intended_at timestamptz not null,
  local_date date not null,
  local_time text not null check (local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  adjustment text not null default 'none' check (adjustment in ('none', 'moved_forward', 'earlier_of_repeated')),
  status text not null default 'scheduled' check (status in (
    'scheduled', 'publishing', 'published', 'rejected', 'ambiguous', 'missed', 'cancelled'
  )),
  status_reason text,
  post_id uuid references gbp_local_post(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (schedule_id, schedule_revision, intended_at)
);
create index post_publication_occurrence_due_idx on post_publication_occurrence (intended_at) where status = 'scheduled';
create index post_publication_occurrence_calendar_idx on post_publication_occurrence (organisation_id, intended_at);
create unique index post_publication_occurrence_post_idx on post_publication_occurrence (post_id) where post_id is not null;

alter table post_publication_schedule enable row level security;
alter table post_publication_schedule force row level security;
create policy tenant_isolation on post_publication_schedule
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, update on post_publication_schedule to naba_app_runtime;

alter table post_publication_occurrence enable row level security;
alter table post_publication_occurrence force row level security;
create policy tenant_isolation on post_publication_occurrence
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, update on post_publication_occurrence to naba_app_runtime;

-- The runner tick's claim, across tenants like claim_due_jobs: at most
-- p_per_org schedules per organisation per call, oldest due first. The lease
-- is the schedule's; a publishing occurrence whose lease expired may already
-- have reached Google, so it becomes ambiguous and blocks its schedule rather
-- than running again.
create function claim_due_publication_schedules(p_limit integer, p_lease_seconds integer, p_per_org integer)
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
    where s.status = 'active' and o.intended_at <= now()
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

insert into schema_migration(version) values ('0075_post_publication_schedules') on conflict (version) do nothing;
commit;
