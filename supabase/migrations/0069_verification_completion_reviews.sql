begin;

alter table gbp_change_set drop constraint gbp_change_set_resource_type_check;
alter table gbp_change_set add constraint gbp_change_set_resource_type_check
  check (resource_type in ('lodging', 'business_info', 'attributes', 'verification_start', 'verification_complete'));
alter table gbp_change_set drop constraint gbp_change_set_private_resource_check;
alter table gbp_change_set add constraint gbp_change_set_private_resource_check
  check (resource_type in ('verification_start', 'verification_complete') or private_payload is null);
alter table gbp_change_set add constraint gbp_verification_completion_private_check
  check (resource_type <> 'verification_complete' or coalesce((
    not (payload ?| array['pin', 'token', 'context'])
    and payload ?& array['name', 'method', 'credentialBindingHash']
    and jsonb_typeof(payload -> 'name') = 'string'
    and payload ->> 'name' ~ '^locations/[A-Za-z0-9_-]+/verifications/[A-Za-z0-9_-]+$'
    and payload ->> 'method' in ('EMAIL', 'PHONE_CALL', 'SMS', 'ADDRESS')
    and payload ->> 'credentialBindingHash' ~ '^[a-f0-9]{64}$'
    and private_payload is not null and octet_length(private_payload) >= 29
  ), false));

-- The encrypted random HMAC key and commitment contain no PIN. Existing forced
-- RLS, immutable runtime payload grants, retention and legal holds still apply.
insert into schema_migration (version) values ('0069_verification_completion_reviews') on conflict (version) do nothing;
commit;
