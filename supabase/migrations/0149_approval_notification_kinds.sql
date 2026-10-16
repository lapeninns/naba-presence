begin;

-- ---------------------------------------------------------------------------
-- Approval notifications (INB-05, owner decision D2).
--
--   notification kind   'approval_requested': a reply was parked for
--                       approval (lib/server/publishing/approval.ts). It is
--                       addressed to the people who could approve it.
--                       'reply_sent_back': an approver rejected it
--                       (lib/server/review-approval.ts). It is addressed to
--                       the person who asked.
--                       The check is rewritten with every kind
--                       0092_mutation_recovery_jobs allows, plus these two.
--
--   notification_incident_recipient
--                       Who an addressed incident is for. Every other kind
--                       reaches whoever can see its location; an addressed
--                       kind reaches only its recipient rows, so no rows
--                       means nobody (lib/domain/notification-preferences.ts,
--                       ADDRESSED_KINDS). A person's rows go with their
--                       app_user row, and with the incident.
--
-- Expand only. The new check is added NOT VALID and validated separately, so
-- the scan of existing rows does not hold the table's exclusive lock; every
-- existing row already satisfies it, because the set only grows.
-- ---------------------------------------------------------------------------

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
      'reply_sent_back'
    )
  ) not valid;
alter table notification_incident
  validate constraint notification_incident_kind_check;

create table notification_incident_recipient (
  organisation_id uuid not null references organisation(id) on delete cascade,
  incident_id uuid not null references notification_incident(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  primary key (incident_id, user_id)
);
create index notification_incident_recipient_user_idx
  on notification_incident_recipient (organisation_id, user_id);
alter table notification_incident_recipient enable row level security;
alter table notification_incident_recipient force row level security;
create policy tenant_isolation on notification_incident_recipient
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, delete on notification_incident_recipient to naba_app_runtime;

insert into schema_migration(version) values ('0149_approval_notification_kinds') on conflict (version) do nothing;
commit;
