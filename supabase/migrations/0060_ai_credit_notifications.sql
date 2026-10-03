begin;

-- Usage notifications (phase A4): one incident per period at 80% and at 100%
-- of the allowance, queued to owners and admins through the 0050 machinery.
-- A separate migration so databases that already applied 0059 pick it up.
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
      'ai_credits_exhausted'
    )
  );

insert into schema_migration (version)
values ('0060_ai_credit_notifications') on conflict (version) do nothing;
commit;
