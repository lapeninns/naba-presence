begin;

-- ---------------------------------------------------------------------------
-- Per-recipient operator alert delivery, and an uncertain send state.
--
-- platform_incident (0050) recorded one notify_status for all of
-- OPS_ALERT_EMAILS together, sent once when the incident opened and never
-- retried: one recipient's provider error was the incident's only attempt,
-- and "sent" meant at least one address got it. platform_incident_delivery
-- is one row per incident and recipient, claimed and retried with back-off
-- by the same driver as tenant notifications
-- (lib/server/notifications/delivery.ts), each send carrying the row's own
-- idempotency key (platform-incident-delivery/<id>).
--
-- status:
--   pending     due at next_attempt_at
--   sent        the provider accepted it
--   failed      the provider certainly did not accept it
--   suppressed  deliberately not sent (no provider configured, the incident
--               resolved before it went out)
--   uncertain   it may have gone out (a timeout or a dropped connection
--               after the request left) and no idempotent retry is left
--
-- notification_delivery gains the same uncertain status: a timed-out send
-- used to settle as failed, which an operator retry would repeat after the
-- provider's idempotency window had passed.
--
-- platform_incident.notify_status, notified_at and notify_error stay, still
-- written as a summary of the deliveries, so code rolled back to before this
-- migration reads what it expects.
--
-- Platform-level like platform_incident: no tenant data, no RLS. The runtime
-- role queues, claims and settles rows; it never deletes them (they go with
-- their incident).
-- ---------------------------------------------------------------------------

create table platform_incident_delivery (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references platform_incident(id) on delete cascade,
  recipient text not null check (length(recipient) between 3 and 320),
  channel text not null default 'email' check (channel in ('email')),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'suppressed', 'uncertain')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz default now(),
  last_error_code text,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (incident_id, recipient, channel)
);

create index platform_incident_delivery_due_idx
  on platform_incident_delivery (next_attempt_at)
  where status = 'pending';

grant select, insert, update on platform_incident_delivery to naba_app_runtime;

alter table notification_delivery
  drop constraint notification_delivery_status_check;
alter table notification_delivery
  add constraint notification_delivery_status_check check (
    status in ('pending', 'sent', 'failed', 'suppressed', 'uncertain')
  );

insert into schema_migration (version)
values ('0095_platform_incident_delivery')
on conflict (version) do nothing;

commit;
