begin;

-- ---------------------------------------------------------------------------
-- S3: review_topic_negative, raised by the health tick when a venue's
-- negative share for one topic over the last 14 days is well above its own
-- baseline for the 90 days before (lib/domain/review-topics-trends.ts
-- isNegativeSpike; lib/server/review-topics-alerts.ts). A condition kind:
-- one open incident per venue and topic (subject_id
-- '<location id>:<topic>'), resolved when the rule stops holding.
--
-- The check is re-listed whole, as 0149 did: drop, add NOT VALID, validate.
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
      'reply_sent_back',
      'review_topic_negative'
    )
  ) not valid;
alter table notification_incident
  validate constraint notification_incident_kind_check;

insert into schema_migration (version)
values ('0321_review_topic_notification_kind') on conflict (version) do nothing;
commit;
