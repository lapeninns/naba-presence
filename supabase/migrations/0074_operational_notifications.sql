begin;

-- WP8: operational incidents beyond the original five conditions, per-recipient
-- read state (reading never resolves), per-user preferences, daily digests and
-- provider delivery evidence. Additive: existing incidents, deliveries and their
-- email behaviour are unchanged.

alter table notification_incident drop constraint notification_incident_kind_check;
alter table notification_incident add constraint notification_incident_kind_check check (
  kind in (
    'connection_reconnect', 'listing_access_lost', 'listing_stale', 'low_rating_review', 'connection_owner_left',
    'publication_failed', 'publication_unresolved', 'schedule_missed', 'schedule_blocked',
    'bulk_completed_with_failures', 'verification_changed', 'suggestions_available', 'resource_stale'
  )
);
-- Location-scoped incidents reach members who can see that location; account
-- scoped ones (location_id null) stay owner/admin only.
alter table notification_incident
  add column location_id uuid references location(id) on delete cascade,
  add column reason text;
create index notification_incident_location_idx
  on notification_incident (organisation_id, location_id, opened_at desc)
  where location_id is not null;

create table notification_recipient_state (
  organisation_id uuid not null references organisation(id) on delete cascade,
  incident_id uuid not null references notification_incident(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (incident_id, user_id)
);
create index notification_recipient_state_user_idx
  on notification_recipient_state (organisation_id, user_id);
alter table notification_recipient_state enable row level security;
alter table notification_recipient_state force row level security;
create policy tenant_isolation on notification_recipient_state
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, update, delete on notification_recipient_state to naba_app_runtime;

-- Only explicit choices are stored; defaults live in lib/domain/notification-preferences.ts.
create table notification_preference (
  organisation_id uuid not null references organisation(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  event_kind text not null,
  channel text not null check (channel in ('in_app', 'email')),
  mode text not null check (mode in ('immediate', 'digest', 'off')),
  updated_at timestamptz not null default now(),
  primary key (organisation_id, user_id, event_kind, channel),
  check (channel = 'email' or mode in ('immediate', 'off'))
);
alter table notification_preference enable row level security;
alter table notification_preference force row level security;
create policy tenant_isolation on notification_preference
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, update, delete on notification_preference to naba_app_runtime;

-- One digest per recipient and local day; its incidents are frozen when built.
create table notification_digest (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  digest_date date not null,
  incident_ids uuid[] not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, user_id, digest_date),
  check (cardinality(incident_ids) between 1 and 200)
);
alter table notification_digest enable row level security;
alter table notification_digest force row level security;
create policy tenant_isolation on notification_digest
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert on notification_digest to naba_app_runtime;

-- Deliveries: the send queue keeps `status`; provider evidence is a separate,
-- monotonic `delivery_state`. Acceptance is not inbox delivery, and delivery
-- is not proof anyone read the message.
alter table notification_delivery alter column incident_id drop not null;
alter table notification_delivery
  add column digest_id uuid references notification_digest(id) on delete cascade,
  add column idempotency_key text,
  add column delivery_state text not null default 'queued' check (delivery_state in (
    'queued', 'accepted', 'delivery_delayed', 'delivered', 'bounced', 'complained', 'failed', 'suppressed', 'unknown'
  )),
  add column delivery_state_at timestamptz,
  add constraint notification_delivery_subject_check check ((incident_id is null) <> (digest_id is null));
update notification_delivery set delivery_state = case status
  when 'sent' then 'accepted' when 'failed' then 'failed' when 'suppressed' then 'suppressed' else 'queued' end,
  delivery_state_at = coalesce(sent_at, created_at);
create unique index notification_delivery_digest_idx
  on notification_delivery (digest_id, recipient_user_id, channel) where digest_id is not null;
create unique index notification_delivery_idempotency_idx
  on notification_delivery (idempotency_key) where idempotency_key is not null;
create index notification_delivery_provider_message_idx
  on notification_delivery (provider_message_id) where provider_message_id is not null;

create table notification_delivery_event (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  delivery_id uuid not null references notification_delivery(id) on delete cascade,
  provider_event_id text not null unique,
  event_type text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  applied boolean not null
);
create index notification_delivery_event_delivery_idx on notification_delivery_event (delivery_id, occurred_at);
alter table notification_delivery_event enable row level security;
alter table notification_delivery_event force row level security;
create policy tenant_isolation on notification_delivery_event
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select on notification_delivery_event to naba_app_runtime;

-- A verified provider webhook arrives without a tenant. This function finds
-- the delivery by provider message id, records the event once (replays are
-- ignored by provider_event_id), and advances delivery_state only to a state
-- of higher precedence, so out-of-order callbacks never move it backwards.
create function record_email_delivery_event(
  p_provider_message_id text, p_provider_event_id text, p_event_type text, p_occurred_at timestamptz
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_delivery notification_delivery%rowtype;
  v_state text;
  v_rank int;
  v_current int;
  v_applied boolean := false;
begin
  v_state := case p_event_type
    when 'email.sent' then 'accepted'
    when 'email.delivery_delayed' then 'delivery_delayed'
    when 'email.delivered' then 'delivered'
    when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained'
    when 'email.failed' then 'failed'
    else null end;
  select * into v_delivery from notification_delivery where provider_message_id = p_provider_message_id for update;
  if not found then return 'unknown_message'; end if;
  if exists (select 1 from notification_delivery_event where provider_event_id = p_provider_event_id) then
    return 'duplicate';
  end if;
  if v_state is not null then
    v_rank := case v_state when 'accepted' then 1 when 'delivery_delayed' then 2 when 'delivered' then 3 else 4 end;
    v_current := case v_delivery.delivery_state
      when 'queued' then 0 when 'unknown' then 0 when 'accepted' then 1 when 'delivery_delayed' then 2
      when 'delivered' then 3 when 'suppressed' then 5 else 4 end;
    if v_rank > v_current then
      update notification_delivery set delivery_state = v_state, delivery_state_at = p_occurred_at where id = v_delivery.id;
      v_applied := true;
    end if;
  end if;
  insert into notification_delivery_event (organisation_id, delivery_id, provider_event_id, event_type, occurred_at, applied)
  values (v_delivery.organisation_id, v_delivery.id, p_provider_event_id, p_event_type, p_occurred_at, v_applied);
  return case when v_applied then 'applied' when v_state is null then 'ignored' else 'superseded' end;
end $$;
revoke all on function record_email_delivery_event(text, text, text, timestamptz) from public;
grant execute on function record_email_delivery_event(text, text, text, timestamptz) to naba_app_runtime;

insert into schema_migration(version) values ('0074_operational_notifications') on conflict (version) do nothing;
commit;
