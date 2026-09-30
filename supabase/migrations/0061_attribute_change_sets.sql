begin;

alter table gbp_change_set drop constraint gbp_change_set_resource_type_check;
alter table gbp_change_set add constraint gbp_change_set_resource_type_check
  check (resource_type in ('lodging', 'business_info', 'attributes'));

insert into schema_migration (version) values ('0061_attribute_change_sets') on conflict (version) do nothing;
commit;
