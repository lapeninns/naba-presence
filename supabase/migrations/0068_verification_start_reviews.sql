begin;

alter table gbp_change_set drop constraint gbp_change_set_resource_type_check;
alter table gbp_change_set add constraint gbp_change_set_resource_type_check
  check (resource_type in ('lodging', 'business_info', 'attributes', 'verification_start'));
alter table gbp_change_set add column private_payload bytea;
alter table gbp_change_set add constraint gbp_change_set_private_resource_check
  check (resource_type = 'verification_start' or private_payload is null);
alter table gbp_change_set add constraint gbp_verification_private_payload_check
  check (resource_type <> 'verification_start' or (
    not (payload ?| array['pin', 'token', 'context'])
    and payload ? 'contextProvided'
    and jsonb_typeof(payload -> 'contextProvided') = 'boolean'
    and private_payload is not null
    and octet_length(private_payload) >= 29
  ));

-- Existing forced tenant RLS, review retention/legal holds, and approval-only
-- UPDATE grants apply. The encrypted context is immutable for the runtime role.
insert into schema_migration (version) values ('0068_verification_start_reviews') on conflict (version) do nothing;
commit;
