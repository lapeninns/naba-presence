begin;

-- ---------------------------------------------------------------------------
-- S5 · Google change watch (lib/server/google-change-watch.ts).
--
--   listing_google_watch     one row per listing that someone configured:
--                            which fields are protected, who is alerted, and
--                            the primary category we last published or
--                            accepted (no other table keeps one). Absent
--                            means every field is protected and the owners
--                            and admins are alerted ('managers'; 'everyone'
--                            is everyone who can see the listing). Changes
--                            are audited (listing.google_watch.updated).
--   listing_google_watch_recipient
--                            the chosen people when alert_mode = 'chosen'.
--                            A person's rows go with their app_user row; one
--                            who can no longer see the listing is skipped
--                            when an alert is addressed.
--   listing_google_change    one row per protected field and Google value
--                            that moved off ours: both values, their hashes,
--                            and what happened next ("Put ours back" made a
--                            reviewed change: its change set or change
--                            request; "Accept Google's"; Google restored
--                            ours). At most one live (open or reverting) row
--                            per listing and field.
--
--   notification kind        'listing_google_changed', addressed to the
--                            watch's recipients (notification_incident_
--                            recipient, 0149). The check is rewritten with
--                            every kind 0149 allows, plus this one.
--
-- Expand only. New tables, and a check that only gains a value: every
-- existing row already satisfies it. Added NOT VALID, then validated.
-- ---------------------------------------------------------------------------

create table listing_google_watch (
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  protected_fields text[] not null default array[
    'name', 'description', 'phone', 'website', 'primaryCategory',
    'regularHours', 'specialHours'
  ]::text[],
  alert_mode text not null default 'managers'
    check (alert_mode in ('managers', 'everyone', 'chosen')),
  category_baseline text,
  category_baseline_label text,
  category_baseline_at timestamptz,
  updated_by uuid references app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organisation_id, location_id),
  constraint listing_google_watch_fields_check check (
    protected_fields <@ array[
      'name', 'description', 'phone', 'website', 'primaryCategory',
      'regularHours', 'specialHours'
    ]::text[]
  ),
  constraint listing_google_watch_category_check check (
    category_baseline is null or char_length(category_baseline) between 1 and 255
  )
);
create index listing_google_watch_location_idx
  on listing_google_watch (location_id);
create index listing_google_watch_updated_by_idx
  on listing_google_watch (updated_by) where updated_by is not null;
create trigger listing_google_watch_updated_at
  before update on listing_google_watch
  for each row execute function set_updated_at();
alter table listing_google_watch enable row level security;
alter table listing_google_watch force row level security;
create policy tenant_isolation on listing_google_watch
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, update on listing_google_watch to naba_app_runtime;

create table listing_google_watch_recipient (
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (organisation_id, location_id, user_id),
  foreign key (organisation_id, location_id)
    references listing_google_watch(organisation_id, location_id) on delete cascade
);
-- Serve the cascades from app_user and location.
create index listing_google_watch_recipient_user_idx
  on listing_google_watch_recipient (user_id);
create index listing_google_watch_recipient_location_idx
  on listing_google_watch_recipient (location_id);
alter table listing_google_watch_recipient enable row level security;
alter table listing_google_watch_recipient force row level security;
create policy tenant_isolation on listing_google_watch_recipient
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, delete on listing_google_watch_recipient to naba_app_runtime;

create table listing_google_change (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  field text not null check (
    field in (
      'name', 'description', 'phone', 'website', 'primaryCategory',
      'regularHours', 'specialHours'
    )
  ),
  status text not null default 'open'
    check (status in ('open', 'reverting', 'accepted', 'resolved', 'superseded')),
  resolution text
    check (resolution in ('google_restored', 'published', 'unwatched')),
  ours_value jsonb not null,
  google_value jsonb not null,
  ours_hash text not null check (char_length(ours_hash) = 64),
  google_hash text not null check (char_length(google_hash) = 64),
  local_edits boolean not null default false,
  regular_days smallint[] not null default '{}',
  special_dates text[] not null default '{}',
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  decided_by uuid references app_user(id) on delete set null,
  decided_at timestamptz,
  revert_change_set_id uuid references gbp_change_set(id) on delete set null,
  revert_operation_id uuid references mutation_operation(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listing_google_change_status_resolution_check check (
    (status = 'resolved') = (resolution is not null)
  )
);
create unique index listing_google_change_live_idx
  on listing_google_change (organisation_id, location_id, field)
  where status in ('open', 'reverting');
create index listing_google_change_location_idx
  on listing_google_change (organisation_id, location_id, detected_at desc);
create index listing_google_change_location_fk_idx
  on listing_google_change (location_id);
create index listing_google_change_decided_by_idx
  on listing_google_change (decided_by) where decided_by is not null;
create index listing_google_change_change_set_idx
  on listing_google_change (revert_change_set_id)
  where revert_change_set_id is not null;
create index listing_google_change_operation_idx
  on listing_google_change (revert_operation_id)
  where revert_operation_id is not null;
create trigger listing_google_change_updated_at
  before update on listing_google_change
  for each row execute function set_updated_at();
alter table listing_google_change enable row level security;
alter table listing_google_change force row level security;
create policy tenant_isolation on listing_google_change
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, update on listing_google_change to naba_app_runtime;

alter table notification_incident
  drop constraint if exists notification_incident_kind_check;
alter table notification_incident
  add constraint notification_incident_kind_check check (
    kind in (
      'connection_reconnect',
      'listing_access_lost',
      'listing_stale',
      'low_rating_review',
      'connection_owner_left',
      'ai_credits_low',
      'ai_credits_exhausted',
      'publication_failed',
      'publication_unresolved',
      'schedule_missed',
      'schedule_blocked',
      'bulk_completed_with_failures',
      'verification_changed',
      'suggestions_available',
      'resource_stale',
      'mutation_unconfirmed',
      'approval_requested',
      'reply_sent_back',
      'listing_google_changed'
    )
  ) not valid;
alter table notification_incident
  validate constraint notification_incident_kind_check;

insert into schema_migration (version)
values ('0340_listing_google_watch') on conflict (version) do nothing;

commit;
