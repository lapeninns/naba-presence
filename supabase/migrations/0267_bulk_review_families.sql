begin;

-- P09-R8: resumable bulk review work on the bulk engine.
--
--   * Two families join the engine: `review_approval` (approve each parked
--     reply exactly as shown, then publish it) and `review_template_reply`
--     (draft the rating template for a rating-only review, check it, then
--     publish it or submit it for approval). Assigning and "no reply
--     needed" stay synchronous and never become batches.
--   * A review batch is one child per review, at the review's location, so
--     it spans up to 100 reviews (the inbox's existing limit) rather than
--     50 listings times a change list: the target and item caps are widened
--     for these two families only, and their children may number up to 100
--     (seq 0..99) at a single listing.
--   * Each review child names its review and, once a publish started, the
--     reply's publish attempt (publish_attempt). Reply publishes keep their
--     own pipeline and recovery (lib/server/publishing/*, the job runner's
--     reply retry and readback), so an unresolved child settles from that
--     attempt (bulk_children_to_reconcile) and is never sent again from the
--     batch. Both references are kept in the child's own organisation by a
--     guard trigger rather than composite keys: review and publish_attempt
--     carry no (organisation_id, id) key, and adding one would rewrite the
--     review table's indexes under lock.
--   * requeue_interrupted_review_children(): a review child whose claim was
--     interrupted (its lease ran out mid-dispatch) is queued again while its
--     dispatch window is open. Re-running it is safe by construction: the
--     template draft has a deterministic id, the approval decision is
--     already recorded, and executePublish recovers any attempt it finds
--     under the reply's idempotency key before it sends. A child is run at
--     most five times this way, so a fault that recurs on every run stops.

alter table bulk_listing_operation
  drop constraint bulk_listing_operation_operation_check,
  add constraint bulk_listing_operation_operation_check check (operation in (
    'regular_hours', 'special_hours', 'more_hours', 'attributes', 'place_action',
    'business_info', 'categories', 'lodging', 'food_menus', 'post_draft', 'photos',
    'review_approval', 'review_template_reply',
    'mixed'
  )),
  drop constraint bulk_listing_operation_target_cap,
  add constraint bulk_listing_operation_target_cap check (
    cardinality(target_location_ids) >= 1
    and (
      cardinality(target_location_ids) <= 50
      or legacy_over_cap
      or (operation in ('review_approval', 'review_template_reply')
          and cardinality(target_location_ids) <= 100)
    )
  ),
  drop constraint bulk_listing_operation_items_check,
  add constraint bulk_listing_operation_items_check check (
    case when jsonb_typeof(items) = 'array'
      then jsonb_array_length(items) between 1 and
        case when operation in ('review_approval', 'review_template_reply') then 100 else 50 end
      else false end
  ),
  drop constraint bulk_listing_operation_item_cap,
  add constraint bulk_listing_operation_item_cap check (
    case when jsonb_typeof(items) = 'array'
      then operation in ('review_approval', 'review_template_reply')
        or cardinality(target_location_ids) * jsonb_array_length(items) <= 500
      else false end
  );

alter table bulk_listing_child
  drop constraint bulk_listing_child_resource_key_check,
  add constraint bulk_listing_child_resource_key_check check (resource_key in (
    'hours', 'attributes', 'place_actions', 'business_info', 'lodging',
    'food_menus', 'posts', 'media', 'reviews'
  )),
  drop constraint bulk_listing_child_seq_check,
  add constraint bulk_listing_child_seq_check check (
    seq between 0 and 49
    or (input->>'operation' in ('review_approval', 'review_template_reply')
        and seq between 0 and 99)
  ),
  add column review_id uuid references review(id) on delete set null,
  add column publish_attempt_id uuid references publish_attempt(id) on delete set null,
  add constraint bulk_listing_child_review_unique unique (operation_id, review_id);

create index bulk_listing_child_publish_attempt_idx
  on bulk_listing_child (publish_attempt_id)
  where publish_attempt_id is not null;

create function bulk_listing_child_review_tenant_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.review_id is not null and not exists (
    select 1 from review r
    where r.id = new.review_id and r.organisation_id = new.organisation_id
  ) then
    raise exception 'a bulk child names a review of its own organisation only'
      using errcode = 'foreign_key_violation';
  end if;
  if new.publish_attempt_id is not null and not exists (
    select 1 from publish_attempt pa
    where pa.id = new.publish_attempt_id and pa.organisation_id = new.organisation_id
  ) then
    raise exception 'a bulk child names a publish attempt of its own organisation only'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end $$;
create trigger bulk_listing_child_review_tenant_guard
  before insert or update of review_id, publish_attempt_id, organisation_id on bulk_listing_child
  for each row execute function bulk_listing_child_review_tenant_guard();

-- 0262's set, plus review children whose reply attempt has settled.
create or replace function bulk_children_to_reconcile(p_limit integer)
returns table (organisation_id uuid, child_id uuid)
language sql security definer set search_path = public as $$
  select due.organisation_id, due.child_id from (
    select c.organisation_id, c.id as child_id, m.updated_at as settled_at
    from bulk_listing_child c
    join mutation_operation m
      on m.organisation_id = c.organisation_id and m.id = c.mutation_operation_id
    where c.status = 'ambiguous'
      and m.state in ('confirmed_applied', 'awaiting_confirmation', 'failed', 'rejected')
    union all
    select c.organisation_id, c.id, coalesce(pa.finished_at, pa.started_at)
    from bulk_listing_child c
    join publish_attempt pa
      on pa.id = c.publish_attempt_id and pa.organisation_id = c.organisation_id
    where c.status = 'ambiguous'
      and pa.status in ('succeeded', 'failed', 'superseded')
  ) due
  order by due.settled_at, due.child_id
  limit p_limit
$$;
revoke all on function bulk_children_to_reconcile(integer) from public;
grant execute on function bulk_children_to_reconcile(integer) to naba_app_runtime;

create function requeue_interrupted_review_children(p_limit integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  -- A batch whose only open child was interrupted has already been finished
  -- (completed_with_failures) by the tick that reclaimed the lease; it runs
  -- again with the requeued child, as a retry would make it.
  with due as (
    select c.id
    from bulk_listing_child c
    join bulk_listing_operation o on o.id = c.operation_id
    where c.status = 'ambiguous'
      and c.result_code = 'execution_interrupted'
      and c.input->>'operation' in ('review_approval', 'review_template_reply')
      and c.attempts < 5
      and o.status in ('running', 'completed_with_failures')
      and o.dispatch_expires_at > now()
    order by c.finished_at nulls first, c.id
    limit p_limit
    for update of c skip locked
  ), requeued as (
    update bulk_listing_child c
    set status = 'queued', next_attempt_at = now(), finished_at = null,
        confirmation_state = 'unrecorded'
    from due where c.id = due.id
    returning c.operation_id
  ), reopened as (
    update bulk_listing_operation o
    set status = 'running', finished_at = null, updated_at = now()
    where o.id in (select operation_id from requeued)
      and o.status = 'completed_with_failures'
    returning o.id
  )
  select count(*)::integer into v_count from requeued;
  return v_count;
end $$;
revoke all on function requeue_interrupted_review_children(integer) from public;
grant execute on function requeue_interrupted_review_children(integer) to naba_app_runtime;

insert into schema_migration(version) values ('0267_bulk_review_families') on conflict (version) do nothing;
commit;
