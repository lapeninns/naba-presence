begin;

create table gbp_change_set (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  google_account_id uuid not null references google_account(id) on delete cascade,
  connection_id uuid not null references google_connection(id) on delete cascade,
  target_resource_name text not null,
  resource_type text not null check (resource_type in ('lodging')),
  requested_by uuid not null references app_user(id) on delete restrict,
  approved_by uuid references app_user(id) on delete restrict,
  approved_at timestamptz,
  payload jsonb not null,
  payload_hash text not null,
  update_mask text[] not null,
  baseline jsonb not null,
  baseline_hash text not null,
  require_two_person_approval boolean not null,
  created_at timestamptz not null default now(),
  approval_expires_at timestamptz not null default now() + interval '24 hours',
  expires_at timestamptz not null default now() + interval '180 days',
  check ((approved_by is null) = (approved_at is null))
);

create index gbp_change_set_location_idx on gbp_change_set (organisation_id, location_id, created_at desc, id);
create index gbp_change_set_expiry_idx on gbp_change_set (organisation_id, expires_at);
alter table gbp_change_set enable row level security;
alter table gbp_change_set force row level security;
create policy gbp_change_set_isolation on gbp_change_set
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, delete on gbp_change_set to naba_app_runtime;
revoke update on gbp_change_set from naba_app_runtime;
grant update (approved_by, approved_at) on gbp_change_set to naba_app_runtime;

alter table gbp_management_mutation add column change_set_id uuid references gbp_change_set(id) on delete set null;
create unique index gbp_management_mutation_change_set_idx on gbp_management_mutation (organisation_id, change_set_id) where change_set_id is not null;

insert into schema_migration (version) values ('0059_gbp_change_sets') on conflict (version) do nothing;
commit;
