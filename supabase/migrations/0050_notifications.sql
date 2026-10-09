begin;

-- ---------------------------------------------------------------------------
-- Operational notifications: durable incidents, deduplicated deliveries.
--
-- Nothing told anyone when a connection broke unless they happened to be
-- looking. The health evaluation (lib/server/notifications, every 15 minutes)
-- now turns what it finds into incidents and each incident into at most one
-- email per recipient.
--
-- notification_incident   one row per ongoing problem, per tenant. The
--                         partial unique index is the deduplication: a
--                         health check that sees the same broken connection
--                         every 15 minutes touches last_seen_at on the open
--                         incident instead of opening another. A problem that
--                         clears is resolved; if it comes back, that is a new
--                         incident and a new email, which is the point.
--                         `summary` holds display fields only (an email
--                         address, a listing title, a star rating) and never
--                         a credential.
--
-- notification_delivery   one row per (incident, recipient, channel), unique,
--                         so retries of the evaluation or of the send can
--                         never email the same person twice about the same
--                         incident. Retried with back-off; 'suppressed' when
--                         there is no provider or the recipient has no
--                         address.
--
-- platform_incident       infrastructure problems (a cron heartbeat gone
--                         stale) for operators. Not tenant data, so no RLS;
--                         like ops_heartbeat it is read and written outside
--                         withTenant.
-- ---------------------------------------------------------------------------

create table notification_incident (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  kind text not null check (
    kind in (
      'connection_reconnect',
      'listing_access_lost',
      'listing_stale',
      'low_rating_review',
      'connection_owner_left'
    )
  ),
  subject_type text not null,
  subject_id text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  summary jsonb not null default '{}'::jsonb,
  opened_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index notification_incident_open_idx
  on notification_incident (organisation_id, kind, subject_id)
  where status = 'open';

-- A review is only ever announced once, open or resolved.
create unique index notification_incident_review_once_idx
  on notification_incident (organisation_id, subject_id)
  where kind = 'low_rating_review';

create index notification_incident_recent_idx
  on notification_incident (organisation_id, opened_at desc);

alter table notification_incident enable row level security;
alter table notification_incident force row level security;
create policy tenant_isolation on notification_incident
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );
grant select, insert, update, delete on notification_incident to naba_app_runtime;

create table notification_delivery (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  incident_id uuid not null references notification_incident(id) on delete cascade,
  recipient_user_id uuid not null references app_user(id) on delete cascade,
  channel text not null default 'email' check (channel in ('email')),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'suppressed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz default now(),
  last_error_code text,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (incident_id, recipient_user_id, channel)
);

create index notification_delivery_due_idx
  on notification_delivery (organisation_id, next_attempt_at)
  where status = 'pending';

alter table notification_delivery enable row level security;
alter table notification_delivery force row level security;
create policy tenant_isolation on notification_delivery
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );
grant select, insert, update, delete on notification_delivery to naba_app_runtime;

create table platform_incident (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('stale_heartbeat', 'google_quota_pressure')),
  subject text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  details jsonb not null default '{}'::jsonb,
  opened_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  notify_status text check (notify_status in ('sent', 'failed', 'suppressed')),
  notified_at timestamptz,
  notify_error text
);

create unique index platform_incident_open_idx
  on platform_incident (kind, subject)
  where status = 'open';

grant select, insert, update on platform_incident to naba_app_runtime;

insert into schema_migration (version) values ('0050_notifications')
on conflict (version) do nothing;

commit;
