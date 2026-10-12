begin;

-- ---------------------------------------------------------------------------
-- A sticky "may have sent" mark on both email delivery queues.
--
-- 0095 settles a send whose fate is unknown (a timeout, a dropped connection)
-- as uncertain, but only from the attempt that just ran: a timed-out first
-- attempt followed by refused retries settled failed, and an operator retry
-- of a failed row is allowed at any age, so it could send again after the
-- provider's 24-hour idempotency window had passed, the duplicate the
-- uncertain state exists to prevent.
--
-- may_have_sent is set by the first uncertain attempt and never cleared
-- (lib/server/notifications/delivery.ts ORs it in on every settle, and the
-- operator requeue leaves it). A row carrying it is sent again only inside
-- the idempotency window, checked when it is claimed, and otherwise settles
-- uncertain, never failed or suppressed.
--
-- Backfill: rows already settled uncertain or with delivery_state unknown,
-- and rows whose last attempt was a timeout or a lost connection. A row whose
-- uncertain attempt was overwritten by a later refusal left no trace, so it
-- stays unmarked.
--
-- Adding a column with a constant default is a catalog change only; the
-- updates touch only the matching rows.
-- ---------------------------------------------------------------------------

alter table notification_delivery
  add column may_have_sent boolean not null default false;

alter table platform_incident_delivery
  add column may_have_sent boolean not null default false;

update notification_delivery
set may_have_sent = true
where status = 'uncertain'
   or delivery_state = 'unknown'
   or last_error_code in ('email_timeout', 'email_connection_lost');

update platform_incident_delivery
set may_have_sent = true
where status = 'uncertain'
   or last_error_code in ('email_timeout', 'email_connection_lost');

insert into schema_migration (version)
values ('0096_delivery_may_have_sent')
on conflict (version) do nothing;

commit;
