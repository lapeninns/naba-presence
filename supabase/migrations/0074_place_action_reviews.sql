begin;

alter table gbp_change_set drop constraint gbp_change_set_resource_type_check;
alter table gbp_change_set add constraint gbp_change_set_resource_type_check
  check (resource_type in ('lodging', 'business_info', 'attributes', 'verification_start', 'verification_complete', 'administration_access', 'location_lifecycle', 'place_action'));
alter table gbp_change_set add constraint gbp_place_action_payload_check
  check (resource_type <> 'place_action' or coalesce((
    jsonb_typeof(payload -> 'request') = 'object'
    and payload -> 'request' ->> 'operation' in ('create', 'update', 'delete')
    and payload ->> 'connectionId' = connection_id::text
    and jsonb_typeof(payload -> 'credentialGeneration') = 'number'
    and (payload ->> 'credentialGeneration') ~ '^[0-9]+$'
    and jsonb_typeof(payload -> 'observedAt') = 'string'
    and private_payload is null and update_mask = array[]::text[]
  ), false));

alter table place_action_mutation
  add column change_set_id uuid references gbp_change_set(id) on delete restrict,
  add column google_account_id uuid references google_account(id) on delete restrict,
  add column execution_state text not null default 'unrecorded'
    check (execution_state in ('unrecorded', 'pending', 'accepted', 'rejected', 'unknown')),
  add column confirmation_state text not null default 'unrecorded'
    check (confirmation_state in ('unrecorded', 'pending', 'confirmed', 'unresolved')),
  add column confirmation_response jsonb,
  add column confirmation_observed_at timestamptz,
  add column confirmation_error_code text;
create unique index place_action_review_attempt on place_action_mutation (organisation_id, change_set_id)
  where change_set_id is not null;
create index place_action_unresolved_account on place_action_mutation (organisation_id, google_account_id, confirmation_state)
  where change_set_id is not null;

create function protect_reviewed_place_action() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.change_set_id is not null and
    (new.organisation_id, new.location_id, new.external_location_id, new.actor_user_id,
     new.google_account_id, new.operation, new.idempotency_key, new.requested_payload,
     new.google_link_name, new.change_set_id, new.created_at, new.started_at)
    is distinct from
    (old.organisation_id, old.location_id, old.external_location_id, old.actor_user_id,
     old.google_account_id, old.operation, old.idempotency_key, old.requested_payload,
     old.google_link_name, old.change_set_id, old.created_at, old.started_at) then
    raise exception 'Reviewed action link intent is immutable' using errcode = '23514';
  end if;
  if new.change_set_id is not null and not exists (
    select 1 from gbp_change_set c where c.id = new.change_set_id
      and c.organisation_id = new.organisation_id and c.location_id = new.location_id
      and c.google_account_id = new.google_account_id and c.resource_type = 'place_action'
      and c.payload = new.requested_payload and c.payload -> 'request' ->> 'operation' = new.operation
      and new.idempotency_key = 'place_action:' || c.id::text
      and (new.operation = 'create' and new.google_link_name is null
        or new.operation <> 'create' and new.google_link_name = c.payload -> 'request' ->> 'name')
  ) then raise exception 'Action link attempt must match its exact review' using errcode = '23514'; end if;
  return new;
end $$;
create trigger reviewed_place_action_intent before insert or update on place_action_mutation
  for each row execute function protect_reviewed_place_action();

insert into schema_migration(version) values ('0074_place_action_reviews') on conflict (version) do nothing;
commit;
