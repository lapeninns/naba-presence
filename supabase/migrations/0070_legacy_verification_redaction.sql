begin;

-- A transaction-local allowlist preserves provider request identities and
-- known outcomes without retaining arbitrary response/error echoes.
create function pg_temp.legacy_verification_public(value jsonb)
returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'historicalRedacted', true,
    'name', case when jsonb_typeof(value -> 'name') = 'string'
      and value ->> 'name' ~ '^locations/[A-Za-z0-9_-]+/verifications/[A-Za-z0-9_-]+$'
      and length(value ->> 'name') <= 512 then value -> 'name' end,
    'method', case when value ->> 'method' in
      ('VERIFICATION_METHOD_UNSPECIFIED', 'ADDRESS', 'EMAIL', 'PHONE_CALL', 'SMS', 'AUTO', 'VETTED_PARTNER') then value -> 'method' end,
    'state', case when value ->> 'state' in
      ('STATE_UNSPECIFIED', 'PENDING', 'COMPLETED', 'FAILED') then value -> 'state' end,
    'createTime', case when jsonb_typeof(value -> 'createTime') = 'string'
      and value ->> 'createTime' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$' then value -> 'createTime' end
  ));
$$;

-- Legacy requests had no reviewed payload boundary. New reviewed attempts,
-- payload hashes and encrypted review bytes remain untouched. All ledger
-- scope, actor, execution/confirmation, timestamp and retention columns stay.
update gbp_management_mutation
set requested_payload = pg_temp.legacy_verification_public(requested_payload),
    google_response = case when google_response is null then null else
      pg_temp.legacy_verification_public(google_response) || case
        when jsonb_typeof(google_response -> 'verification') = 'object' then
          jsonb_build_object('verification', pg_temp.legacy_verification_public(google_response -> 'verification'))
        else '{}'::jsonb end end,
    confirmation_response = case when confirmation_response is null then null
      else pg_temp.legacy_verification_public(confirmation_response) end
where resource_type = 'verification' and change_set_id is null;

-- Old raw voice-of-merchant snapshots are historical, not reviewed baselines.
-- Preserve observation/expiry/creation/update timestamps and hash the canonical
-- replacement JSON exactly as stableGoogleHash does for this single-key object.
lock table gbp_resource_snapshot in access exclusive mode;
alter table gbp_resource_snapshot disable trigger gbp_resource_snapshot_updated_at;
update gbp_resource_snapshot
set payload = '{"historicalRedacted":true}'::jsonb,
    google_hash = encode(digest('{"historicalRedacted":true}', 'sha256'), 'hex')
where resource_type = 'verification';
alter table gbp_resource_snapshot enable trigger gbp_resource_snapshot_updated_at;

-- Only the migration owner may suspend this trigger. The exclusive table lock
-- excludes runtime writes during suspension. Transaction rollback restores
-- trigger state and data; no lasting exemption or runtime grant is added.
lock table audit_log in access exclusive mode;
alter table audit_log disable trigger audit_log_no_update;
update audit_log set metadata = '{"historicalRedacted":true}'::jsonb
where action in ('google.start_verification', 'google.complete_verification');
alter table audit_log enable trigger audit_log_no_update;
drop function pg_temp.legacy_verification_public(jsonb);

insert into schema_migration (version) values ('0070_legacy_verification_redaction') on conflict (version) do nothing;
commit;
