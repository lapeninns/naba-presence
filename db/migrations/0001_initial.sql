begin;

create extension if not exists pgcrypto;

create table if not exists schema_migration (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table organisation (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  default_language_code text not null default 'en',
  default_timezone text not null default 'Europe/London',
  approval_required boolean not null default true,
  direct_publish_consent_at timestamptz,
  direct_publish_consent_by uuid,
  raw_content_retention_days integer not null default 30
    check (raw_content_retention_days between 1 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_user (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  google_subject text unique,
  default_organisation_id uuid references organisation(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table organisation
  add constraint organisation_direct_publish_consent_by_fkey
  foreign key (direct_publish_consent_by)
  references app_user(id)
  on delete set null;

create table organisation_job_route (
  organisation_id uuid primary key references organisation(id) on delete cascade
);

create table member (
  organisation_id uuid not null references organisation(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  can_publish boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (organisation_id, user_id)
);

create table app_session (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references app_user(id) on delete cascade,
  organisation_id uuid not null references organisation(id) on delete cascade,
  support_actor text,
  impersonation_reason text,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table google_connection (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  google_subject text not null,
  google_email text,
  status text not null default 'active'
    check (status in ('active', 'expired', 'revoked', 'error', 'disconnected')),
  scope text not null,
  access_token_ciphertext bytea,
  refresh_token_ciphertext bytea,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  last_refresh_at timestamptz,
  last_error_code text,
  pubsub_topic text,
  notifications_enabled boolean not null default false,
  disconnected_at timestamptz,
  purge_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, google_subject)
);

create table connection_task (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  google_connection_id uuid not null references google_connection(id) on delete cascade,
  task_type text not null check (task_type in ('reconnect')),
  status text not null default 'open'
    check (status in ('open', 'completed', 'cancelled')),
  reason_code text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index connection_task_open_idx
  on connection_task (organisation_id, google_connection_id, task_type)
  where status = 'open';

create table google_account (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  google_connection_id uuid not null references google_connection(id) on delete cascade,
  google_account_name text not null,
  account_name text,
  account_type text,
  role text,
  permission_level text,
  is_active boolean not null default false,
  raw_payload jsonb,
  raw_content_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, google_account_name)
);

create table location (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  name text not null,
  address_json jsonb,
  timezone text not null default 'Europe/London',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, name)
);

create table external_location (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  google_connection_id uuid not null references google_connection(id) on delete cascade,
  google_account_name text not null,
  google_location_name text not null,
  title text not null,
  address_json jsonb,
  verified boolean not null default false,
  raw_payload jsonb,
  raw_content_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, google_location_name)
);

create table location_link (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  external_location_id uuid not null references external_location(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, external_location_id),
  unique (organisation_id, location_id)
);

create table webhook_route (
  google_location_name text primary key,
  organisation_id uuid not null references organisation(id) on delete cascade,
  external_location_id uuid not null references external_location(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create table location_member (
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  can_publish boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (location_id, user_id)
);

create table review (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  external_location_id uuid not null references external_location(id) on delete cascade,
  google_review_name_ciphertext bytea not null,
  google_review_name_hash text not null,
  google_review_id_ciphertext bytea not null,
  google_review_id_hash text not null,
  reviewer_display_name text,
  reviewer_is_anonymous boolean not null default false,
  star_rating smallint not null check (star_rating between 1 and 5),
  review_text text,
  detected_language_code text,
  language_confidence numeric(5,4),
  has_media boolean not null default false,
  create_time timestamptz not null,
  update_time timestamptz not null,
  content_hash text not null,
  workflow_status text not null default 'new'
    check (workflow_status in (
      'new', 'drafted', 'verified', 'awaiting_approval',
      'publish_requested', 'published', 'rejected', 'failed', 'escalated'
    )),
  raw_payload jsonb,
  raw_content_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, google_review_name_hash)
);

create table review_media_item (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  review_id uuid not null references review(id) on delete cascade,
  thumbnail_url text,
  thumbnail_label text,
  video_url text,
  created_at timestamptz not null default now()
);

create table draft (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  review_id uuid not null references review(id) on delete cascade,
  source text not null check (source in ('ai', 'template', 'human')),
  body text not null,
  body_bytes integer not null check (body_bytes >= 0),
  evidence_hash text not null,
  evidence_version text not null default 'v1',
  model_name text,
  model_version text,
  verification_status text not null default 'pending'
    check (verification_status in ('pass', 'warn', 'fail', 'pending')),
  created_by uuid references app_user(id) on delete set null,
  created_at timestamptz not null default now()
);

create table verification_result (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  draft_id uuid not null references draft(id) on delete cascade,
  verdict text not null check (verdict in ('pass', 'warn', 'fail')),
  reasons jsonb not null default '[]'::jsonb,
  checks_version text not null,
  created_at timestamptz not null default now()
);

create table review_reply (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  review_id uuid not null references review(id) on delete cascade,
  current_body text,
  google_reply_state text check (
    google_reply_state is null or google_reply_state in ('PENDING', 'APPROVED', 'REJECTED')
  ),
  google_policy_violation text,
  publish_status text not null default 'not_published'
    check (publish_status in (
      'not_published', 'awaiting_approval', 'accepted',
      'published', 'rejected', 'failed', 'deleted'
    )),
  google_reply_updated_at timestamptz,
  published_by uuid references app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, review_id)
);

create table publish_attempt (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  review_reply_id uuid not null references review_reply(id) on delete cascade,
  draft_id uuid references draft(id) on delete set null,
  idempotency_key text not null,
  request_body_hash text not null,
  status text not null check (
    status in ('started', 'accepted', 'succeeded', 'retryable', 'failed', 'ambiguous')
  ),
  attempt_no integer not null check (attempt_no > 0),
  provider_http_status integer,
  provider_error_code text,
  provider_error_body jsonb,
  next_attempt_at timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (organisation_id, idempotency_key)
);

create table publish_attempt_event (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  publish_attempt_id uuid not null references publish_attempt(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'started', 'provider_accepted', 'provider_rejected',
      'retry_scheduled', 'ambiguity_checked', 'completed'
    )
  ),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table legal_hold (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  review_id uuid not null references review(id) on delete cascade,
  reason text not null,
  approved_by uuid not null references app_user(id) on delete restrict,
  released_by uuid references app_user(id) on delete restrict,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organisation_id, review_id)
);

create table privacy_request (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  request_type text not null check (
    request_type in ('access', 'rectification', 'erasure', 'restriction')
  ),
  status text not null default 'pending' check (
    status in ('pending', 'in_progress', 'completed', 'rejected')
  ),
  subject_reference text not null,
  reason text,
  requested_by uuid not null references app_user(id) on delete restrict,
  resolved_by uuid references app_user(id) on delete restrict,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sync_checkpoint (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  external_location_id uuid not null references external_location(id) on delete cascade,
  sync_type text not null check (sync_type in ('backfill', 'reconcile', 'notification')),
  status text not null check (
    status in ('pending', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  page_token text,
  last_review_update_time timestamptz,
  next_attempt_at timestamptz,
  attempt_count integer not null default 0,
  last_error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, external_location_id, sync_type)
);

create table processed_webhook_event (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  external_location_id uuid references external_location(id) on delete set null,
  provider text not null,
  external_event_id text not null,
  event_type text not null,
  payload_hash text not null,
  payload jsonb,
  payload_expires_at timestamptz,
  retry_count integer not null default 0,
  next_attempt_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received'
    check (status in ('received', 'processed', 'ignored', 'failed')),
  unique (provider, external_event_id)
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  actor_user_id uuid references app_user(id) on delete set null,
  action text not null,
  subject_type text not null,
  subject_id text not null,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organisation_id, request_id, action, subject_type, subject_id)
);

create index review_inbox_updated_idx
  on review (organisation_id, update_time desc, id desc);
create index review_inbox_status_idx
  on review (organisation_id, workflow_status, update_time desc);
create index review_location_idx
  on review (organisation_id, location_id, update_time desc);
create index review_search_idx
  on review using gin (
    to_tsvector(
      'simple',
      coalesce(review_text, '') || ' ' || coalesce(reviewer_display_name, '') ||
      ' ' || google_review_id_hash
    )
  );
create index draft_review_idx on draft (organisation_id, review_id, created_at desc);
create index verification_draft_idx on verification_result (draft_id, created_at desc);
create index audit_log_tenant_time_idx
  on audit_log (organisation_id, created_at desc);
create index app_session_expiry_idx on app_session (expires_at);
create index raw_review_expiry_idx
  on review (raw_content_expires_at) where raw_content_expires_at is not null;
create index location_member_user_idx
  on location_member (organisation_id, user_id, location_id);
create index sync_retry_idx
  on sync_checkpoint (organisation_id, next_attempt_at)
  where status in ('pending', 'failed');
create index webhook_backlog_idx
  on processed_webhook_event (organisation_id, received_at)
  where status in ('received', 'failed');

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function reject_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create or replace function register_organisation_job_route()
returns trigger
language plpgsql
as $$
begin
  insert into organisation_job_route (organisation_id)
  values (new.id)
  on conflict (organisation_id) do nothing;
  return new;
end;
$$;

create or replace function enforce_review_workflow_transition()
returns trigger
language plpgsql
as $$
begin
  if old.workflow_status = new.workflow_status then
    return new;
  end if;
  if current_setting('app.provider_reconciliation', true) = 'true'
    and new.workflow_status in ('new', 'published', 'rejected') then
    return new;
  end if;
  if not (
    (old.workflow_status = 'new' and new.workflow_status in ('drafted', 'escalated', 'published'))
    or (old.workflow_status = 'drafted' and new.workflow_status in ('verified', 'drafted', 'escalated'))
    or (old.workflow_status = 'verified' and new.workflow_status in ('drafted', 'awaiting_approval', 'publish_requested', 'escalated'))
    or (old.workflow_status = 'awaiting_approval' and new.workflow_status in ('drafted', 'publish_requested', 'escalated'))
    or (old.workflow_status = 'publish_requested' and new.workflow_status in ('published', 'rejected', 'failed'))
    or (old.workflow_status = 'published' and new.workflow_status in ('drafted', 'new', 'rejected'))
    or (old.workflow_status = 'rejected' and new.workflow_status in ('drafted', 'publish_requested', 'new'))
    or (old.workflow_status = 'failed' and new.workflow_status in ('drafted', 'publish_requested', 'new'))
    or (old.workflow_status = 'escalated' and new.workflow_status in ('drafted', 'awaiting_approval', 'publish_requested'))
  ) then
    raise exception 'invalid review workflow transition: % -> %',
      old.workflow_status, new.workflow_status;
  end if;
  return new;
end;
$$;

create trigger organisation_updated_at before update on organisation
  for each row execute function set_updated_at();
create trigger organisation_job_route_after_insert after insert on organisation
  for each row execute function register_organisation_job_route();
create trigger app_user_updated_at before update on app_user
  for each row execute function set_updated_at();
create trigger google_connection_updated_at before update on google_connection
  for each row execute function set_updated_at();
create trigger google_account_updated_at before update on google_account
  for each row execute function set_updated_at();
create trigger location_updated_at before update on location
  for each row execute function set_updated_at();
create trigger external_location_updated_at before update on external_location
  for each row execute function set_updated_at();
create trigger location_link_updated_at before update on location_link
  for each row execute function set_updated_at();
create trigger review_updated_at before update on review
  for each row execute function set_updated_at();
create trigger review_workflow_transition before update on review
  for each row execute function enforce_review_workflow_transition();
create trigger review_reply_updated_at before update on review_reply
  for each row execute function set_updated_at();
create trigger sync_checkpoint_updated_at before update on sync_checkpoint
  for each row execute function set_updated_at();
create trigger privacy_request_updated_at before update on privacy_request
  for each row execute function set_updated_at();
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function reject_audit_mutation();
create trigger publish_attempt_event_no_update
  before update or delete on publish_attempt_event
  for each row execute function reject_audit_mutation();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'member', 'google_connection', 'connection_task', 'google_account', 'location',
    'external_location', 'location_link', 'location_member', 'review',
    'review_media_item', 'draft', 'verification_result', 'review_reply',
    'publish_attempt', 'publish_attempt_event', 'legal_hold', 'privacy_request',
    'sync_checkpoint', 'processed_webhook_event', 'audit_log'
  ]
  loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
    execute format(
      'create policy tenant_isolation on %I using (
        organisation_id = nullif(current_setting(''app.organisation_id'', true), '''')::uuid
      ) with check (
        organisation_id = nullif(current_setting(''app.organisation_id'', true), '''')::uuid
      )',
      table_name
    );
  end loop;
end;
$$;

alter table organisation enable row level security;
alter table organisation force row level security;
create policy organisation_isolation on organisation
  using (
    id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );
create policy organisation_provision on organisation
  for insert
  with check (true);

alter table app_session enable row level security;
alter table app_session force row level security;
create policy session_isolation on app_session using (
  organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  or token_hash = nullif(current_setting('app.session_token_hash', true), '')
) with check (
  organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
);

insert into schema_migration (version) values ('0001_initial')
on conflict (version) do nothing;

commit;
