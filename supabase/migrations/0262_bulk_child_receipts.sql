begin;

-- P09-R3: bulk children write through the surface pipelines, with receipts.
--
--   * Each child records the receipt (mutation_operation, 0086) its write
--     went out under, so GET /api/mutations/{id} answers for a bulk write and
--     the `mutation_recover` job (0092) reads an uncertain one back. The
--     composite key keeps the receipt in the child's own organisation.
--   * Hours children publish through the hours editor's own path and its
--     attempt table (hours_sync_attempt). Attribute and action-link children
--     have no receipt-recording editor path (their editors run reviewed
--     change sets), so they record their attempts here, in
--     bulk_listing_write_attempt, which the recovery registry reads back
--     (lib/server/bulk-families/write-attempts.ts).
--   * bulk_children_to_reconcile(): unresolved children whose receipt has
--     since settled (recovery read Google back), for the runner to settle
--     from the receipt without sending anything again.

alter table mutation_operation
  add constraint mutation_operation_tenant_key unique (organisation_id, id);

alter table bulk_listing_child
  add constraint bulk_listing_child_tenant_key unique (organisation_id, id),
  add column mutation_operation_id uuid,
  add constraint bulk_listing_child_mutation_operation_fk
    foreign key (organisation_id, mutation_operation_id)
    references mutation_operation (organisation_id, id);

create index bulk_listing_child_receipt_idx
  on bulk_listing_child (mutation_operation_id)
  where mutation_operation_id is not null;

create table bulk_listing_write_attempt (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  child_id uuid not null,
  location_id uuid references location(id) on delete set null,
  family text not null check (family in ('attributes', 'place_action')),
  idempotency_key text not null check (length(idempotency_key) between 16 and 256),
  status text not null check (status in (
    'validating', 'validated', 'publishing', 'succeeded', 'failed', 'ambiguous'
  )),
  actor_user_id uuid references app_user(id) on delete set null,
  external_location_id uuid references external_location(id) on delete set null,
  google_location_name text not null check (length(google_location_name) <= 512),
  -- What the readback must find: the attributes and mask, or the action
  -- link plan (create / update by name / delete by name) and the link names
  -- the listing held before.
  intended jsonb not null,
  provider_error_code text check (provider_error_code is null or length(provider_error_code) <= 128),
  provider_response_hash text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint bulk_listing_write_attempt_key unique (organisation_id, idempotency_key),
  constraint bulk_listing_write_attempt_child_fk
    foreign key (organisation_id, child_id)
    references bulk_listing_child (organisation_id, id) on delete cascade
);
create index bulk_listing_write_attempt_child_idx
  on bulk_listing_write_attempt (organisation_id, child_id);

alter table bulk_listing_write_attempt enable row level security;
alter table bulk_listing_write_attempt force row level security;
create policy tenant_isolation on bulk_listing_write_attempt
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, update on bulk_listing_write_attempt to naba_app_runtime;

-- Across tenants, for the runner tick: children left `ambiguous` whose
-- receipt is no longer waiting on Google (recovery, or another request,
-- settled it).
create function bulk_children_to_reconcile(p_limit integer)
returns table (organisation_id uuid, child_id uuid)
language sql security definer set search_path = public as $$
  select c.organisation_id, c.id
  from bulk_listing_child c
  join mutation_operation m
    on m.organisation_id = c.organisation_id and m.id = c.mutation_operation_id
  where c.status = 'ambiguous'
    and m.state in ('confirmed_applied', 'awaiting_confirmation', 'failed', 'rejected')
  order by m.updated_at, c.id
  limit p_limit
$$;
revoke all on function bulk_children_to_reconcile(integer) from public;
grant execute on function bulk_children_to_reconcile(integer) to naba_app_runtime;

insert into schema_migration(version) values ('0262_bulk_child_receipts') on conflict (version) do nothing;
commit;
