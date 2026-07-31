begin;

alter table sync_checkpoint
  add column last_metric_date date;

alter table sync_checkpoint
  drop constraint if exists sync_checkpoint_sync_type_check;

alter table sync_checkpoint
  add constraint sync_checkpoint_sync_type_check
  check (
    sync_type in (
      'backfill',
      'reconcile',
      'notification',
      'sweep',
      'performance'
    )
  );

create table performance_metric_daily (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null
    references organisation(id) on delete cascade,
  external_location_id uuid not null
    references external_location(id) on delete cascade,
  metric text not null check (
    metric in (
      'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
      'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
      'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
      'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
      'CALL_CLICKS',
      'WEBSITE_CLICKS',
      'BUSINESS_DIRECTION_REQUESTS',
      'BUSINESS_CONVERSATIONS',
      'BUSINESS_BOOKINGS',
      'BUSINESS_FOOD_ORDERS',
      'BUSINESS_FOOD_MENU_CLICKS'
    )
  ),
  metric_date date not null,
  value bigint not null check (value >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (
    organisation_id,
    external_location_id,
    metric,
    metric_date
  )
);

create index performance_metric_daily_range_idx
  on performance_metric_daily (
    organisation_id,
    metric_date,
    external_location_id,
    metric
  );

create index performance_checkpoint_due_idx
  on sync_checkpoint (organisation_id, next_attempt_at)
  where sync_type = 'performance'
    and status in ('pending', 'failed', 'succeeded');

create trigger performance_metric_daily_updated_at
  before update on performance_metric_daily
  for each row execute function set_updated_at();

alter table performance_metric_daily enable row level security;
alter table performance_metric_daily force row level security;
create policy performance_metric_daily_isolation
  on performance_metric_daily
  using (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  );

grant select, insert, update, delete
  on performance_metric_daily to naba_app_runtime;

insert into schema_migration (version)
values ('0014_performance_metrics')
on conflict (version) do nothing;

commit;
