begin;

alter table gbp_change_set drop constraint gbp_change_set_resource_type_check;
alter table gbp_change_set add constraint gbp_change_set_resource_type_check
  check (resource_type in ('lodging', 'business_info', 'attributes', 'verification_start', 'verification_complete', 'administration_access'));
alter table gbp_change_set add constraint gbp_administration_access_payload_check
  check (resource_type <> 'administration_access' or coalesce((
    jsonb_typeof(payload -> 'request') = 'object'
    and payload -> 'request' ->> 'operation' in ('create_admin', 'update_admin', 'delete_admin', 'accept_invitation', 'decline_invitation')
    and jsonb_typeof(payload -> 'request' -> 'payload') = 'object'
    and payload ->> 'connectionId' = connection_id::text
    and jsonb_typeof(payload -> 'credentialGeneration') = 'number'
    and (payload ->> 'credentialGeneration') ~ '^[0-9]+$'
    and jsonb_typeof(payload -> 'observedAt') = 'string'
    and private_payload is null
    and update_mask = array[]::text[]
  ), false));

insert into schema_migration (version) values ('0071_administration_access_reviews') on conflict (version) do nothing;
commit;
