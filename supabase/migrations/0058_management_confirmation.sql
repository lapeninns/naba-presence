begin;

alter table gbp_management_mutation
  add column execution_state text not null default 'unrecorded'
    check (execution_state in ('unrecorded', 'pending', 'accepted', 'rejected', 'unknown')),
  add column confirmation_state text not null default 'unrecorded'
    check (confirmation_state in ('unrecorded', 'pending', 'confirmed', 'unresolved')),
  add column confirmation_response jsonb,
  add column confirmation_observed_at timestamptz,
  add column confirmation_error_code text;

create index gbp_management_mutation_confirmation_idx
  on gbp_management_mutation (organisation_id, created_at, id)
  where confirmation_state in ('pending', 'unresolved');

insert into schema_migration (version) values ('0058_management_confirmation')
on conflict (version) do nothing;

commit;
