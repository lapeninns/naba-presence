begin;
alter table gbp_management_mutation add column local_reconciliation_state text not null default 'not_required'
  check (local_reconciliation_state in ('not_required', 'pending', 'applied', 'conflict'));
insert into schema_migration (version) values ('0072_lifecycle_local_reconciliation') on conflict (version) do nothing;
commit;
