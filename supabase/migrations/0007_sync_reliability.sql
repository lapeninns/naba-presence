begin;

alter table sync_checkpoint
  add column high_water_update_time timestamptz;

alter table review
  add column provider_deleted_at timestamptz;

alter table processed_webhook_event
  add column last_error_code text;

alter table processed_webhook_event
  drop constraint if exists processed_webhook_event_status_check;

alter table processed_webhook_event
  add constraint processed_webhook_event_status_check
  check (
    status in (
      'received',
      'processing',
      'processed',
      'ignored',
      'failed',
      'discarded',
      'dead'
    )
  );

alter table sync_checkpoint
  drop constraint if exists sync_checkpoint_sync_type_check;

alter table sync_checkpoint
  add constraint sync_checkpoint_sync_type_check
  check (
    sync_type in ('backfill', 'reconcile', 'notification', 'sweep')
  );

create index review_provider_deleted_idx
  on review (organisation_id, provider_deleted_at)
  where provider_deleted_at is not null;

insert into schema_migration (version)
values ('0007_sync_reliability')
on conflict (version) do nothing;

commit;
