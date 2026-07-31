begin;

create table presence_resource_reconcile_state (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  resource text not null check (resource in ('hours', 'profile', 'posts', 'media', 'foodMenus', 'placeActions')),
  status text not null check (status in ('succeeded', 'failed')),
  last_error_code text,
  last_attempt_at timestamptz not null default now(),
  last_succeeded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, location_id, resource)
);

create index presence_resource_reconcile_due_idx
  on presence_resource_reconcile_state (organisation_id, last_attempt_at, location_id);
create trigger presence_resource_reconcile_updated_at
  before update on presence_resource_reconcile_state
  for each row execute function set_updated_at();

alter table presence_resource_reconcile_state enable row level security;
alter table presence_resource_reconcile_state force row level security;
create policy presence_resource_reconcile_state_isolation
  on presence_resource_reconcile_state
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);

grant select, insert, update, delete on presence_resource_reconcile_state to naba_app_runtime;

insert into schema_migration (version)
values ('0023_presence_resource_reconciliation')
on conflict (version) do nothing;

commit;
