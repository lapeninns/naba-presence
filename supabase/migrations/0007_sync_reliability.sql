begin;

alter table sync_checkpoint
  add column high_water_update_time timestamptz;

alter table review
  add column provider_deleted_at timestamptz;

create index review_provider_deleted_idx
  on review (organisation_id, provider_deleted_at)
  where provider_deleted_at is not null;

insert into schema_migration (version)
values ('0007_sync_reliability')
on conflict (version) do nothing;

commit;
