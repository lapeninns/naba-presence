begin;

alter table sync_checkpoint
  add column last_keyword_month date;

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
      'performance',
      'keywords'
    )
  );

create table performance_search_keyword_monthly (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null
    references organisation(id) on delete cascade,
  external_location_id uuid not null
    references external_location(id) on delete cascade,
  metric_month date not null check (
    metric_month = date_trunc('month', metric_month)::date
  ),
  keyword text not null check (
    keyword = lower(btrim(keyword)) and length(keyword) between 1 and 500
  ),
  impressions bigint check (impressions >= 0),
  threshold bigint check (threshold >= 0),
  rank integer not null check (rank >= 1),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(impressions, threshold) = 1),
  unique (
    organisation_id,
    external_location_id,
    metric_month,
    keyword
  )
);

create index performance_search_keyword_monthly_range_idx
  on performance_search_keyword_monthly (
    organisation_id,
    metric_month desc,
    external_location_id,
    rank
  );

create index keyword_checkpoint_due_idx
  on sync_checkpoint (organisation_id, next_attempt_at)
  where sync_type = 'keywords'
    and status in ('pending', 'failed', 'succeeded');

create trigger performance_search_keyword_monthly_updated_at
  before update on performance_search_keyword_monthly
  for each row execute function set_updated_at();

alter table performance_search_keyword_monthly enable row level security;
alter table performance_search_keyword_monthly force row level security;
create policy performance_search_keyword_monthly_isolation
  on performance_search_keyword_monthly
  using (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  );

grant select, insert, update, delete
  on performance_search_keyword_monthly to naba_app_runtime;

insert into schema_migration (version)
values ('0017_search_keyword_performance')
on conflict (version) do nothing;

commit;
