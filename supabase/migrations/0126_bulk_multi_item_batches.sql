begin;

-- P09-R4: multi-item batches and ordering.
--
--   * A batch holds an ordered change list (`items`, 1-50 changes). Each
--     child is one (listing, change) pair, keyed by `item_key`
--     (`<seq>:<family>`), so `(operation_id, location_id)` is no longer
--     unique. At most 500 children per batch: listings x changes.
--   * A child carries its own change (`input`), its position (`seq`) and
--     the earlier children at the same listing it waits for (`depends_on`).
--     `requires_applied` is the subset that must have applied (hard
--     prerequisites, such as category changes before service hours and
--     attributes): when one of those ends without applying, the dependent
--     fails `dependency_not_applied` and is never sent.
--   * The claim skips a child while any of its dependencies is unsettled.
--
-- Rows written before this migration are single-change batches: items is
-- their one input, each child is change 0 with no dependencies.

alter table bulk_listing_operation
  add column items jsonb;

update bulk_listing_operation set items = jsonb_build_array(input);

alter table bulk_listing_operation
  alter column items set not null,
  alter column input drop not null,
  -- `case` so a non-array never reaches jsonb_array_length (which raises).
  add constraint bulk_listing_operation_items_check check (
    case when jsonb_typeof(items) = 'array'
      then jsonb_array_length(items) between 1 and 50 else false end
  ),
  add constraint bulk_listing_operation_item_cap check (
    case when jsonb_typeof(items) = 'array'
      then cardinality(target_location_ids) * jsonb_array_length(items) <= 500 else false end
  ),
  drop constraint bulk_listing_operation_operation_check,
  add constraint bulk_listing_operation_operation_check check (operation in (
    'regular_hours', 'special_hours', 'more_hours', 'attributes', 'place_action', 'mixed'
  ));

alter table bulk_listing_child
  add column seq integer not null default 0,
  add column item_key text,
  add column input jsonb,
  add column depends_on uuid[] not null default array[]::uuid[],
  add column requires_applied uuid[] not null default array[]::uuid[];

update bulk_listing_child c
set item_key = '0:' || o.operation, input = o.input
from bulk_listing_operation o
where o.id = c.operation_id;

alter table bulk_listing_child
  alter column seq drop default,
  alter column item_key set not null,
  alter column input set not null,
  add constraint bulk_listing_child_seq_check check (seq between 0 and 49),
  add constraint bulk_listing_child_item_key_check check (item_key ~ '^[0-9]{1,2}:[a-z_]{1,40}$'),
  add constraint bulk_listing_child_requires_subset check (requires_applied <@ depends_on),
  drop constraint bulk_listing_child_operation_id_location_id_key,
  add constraint bulk_listing_child_item_unique unique (operation_id, location_id, item_key);

-- A dependency is an earlier change of the same batch at the same listing.
-- That also rules out cycles. The runtime role has table-wide insert and
-- update, so a trigger holds the rule for every writer.
create function bulk_listing_child_dependency_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if cardinality(new.depends_on) > 0 and exists (
    select 1 from unnest(new.depends_on) as d(id)
    where not exists (
      select 1 from bulk_listing_child p
      where p.id = d.id and p.operation_id = new.operation_id
        and p.location_id = new.location_id and p.seq < new.seq
    )
  ) then
    raise exception 'a bulk child depends only on earlier changes at its own listing'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger bulk_listing_child_dependency_guard
  before insert or update of depends_on, seq, operation_id, location_id on bulk_listing_child
  for each row execute function bulk_listing_child_dependency_guard();

-- 0125's claim, plus ordering:
--   * a queued child of a running batch whose hard prerequisite ended
--     without applying (failed, conflict, expired, cancelled, skipped) fails
--     `dependency_not_applied` without being sent;
--   * a child is not due while any dependency is unsettled (previewed,
--     queued or running), nor while a hard prerequisite has not applied (an
--     unresolved one may still settle as applied).
create or replace function claim_due_bulk_children(p_limit integer, p_lease_seconds integer, p_per_org integer)
returns table (organisation_id uuid, child_id uuid)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_per_org integer := least(greatest(coalesce(p_per_org, 0), 0), 2);
begin
  perform pg_advisory_xact_lock(hashtextextended('naba:claim_due_bulk_children', 0));

  update bulk_listing_child set status = 'ambiguous', result_code = 'execution_interrupted', finished_at = now(), lease_expires_at = null
  where status = 'running' and lease_expires_at < now();

  with expired as (
    update bulk_listing_operation set status = 'expired', finished_at = now(), updated_at = now()
    where (status = 'previewed' and preview_expires_at <= now())
       or (status = 'approved' and coalesce(dispatch_expires_at, now()) <= now())
    returning id, organisation_id, approved_by, approved_at
  )
  insert into audit_log (organisation_id, actor_user_id, action, subject_type, subject_id, metadata)
  select e.organisation_id, e.approved_by, 'bulk_listing.expired', 'bulk_listing_operation', e.id::text,
    jsonb_build_object('stage', case when e.approved_at is null then 'preview' else 'dispatch' end)
  from expired e;
  update bulk_listing_child c set status = 'expired',
    result_code = case when o.approved_at is null then 'preview_expired' else 'dispatch_expired' end,
    finished_at = now(), next_attempt_at = null
  from bulk_listing_operation o
  where o.id = c.operation_id
    and c.status in ('previewed', 'queued')
    and (o.status = 'expired' or (o.status = 'running' and coalesce(o.dispatch_expires_at, now()) <= now()));

  update bulk_listing_child c set status = 'failed', result_code = 'dependency_not_applied',
    finished_at = now(), next_attempt_at = null
  from bulk_listing_operation o
  where o.id = c.operation_id and o.status = 'running'
    and c.status = 'queued' and cardinality(c.requires_applied) > 0
    and exists (
      select 1 from bulk_listing_child d
      where d.id = any(c.requires_applied)
        and d.status in ('failed', 'conflict', 'expired', 'cancelled', 'skipped')
    );

  return query
  with due as (
    select c.id, c.organisation_id, c.location_id, c.resource_key, coalesce(c.next_attempt_at, c.created_at) as due_at
    from bulk_listing_child c join bulk_listing_operation o on o.id = c.operation_id
    where c.status = 'queued' and o.status = 'running' and coalesce(c.next_attempt_at, now()) <= now()
      and o.dispatch_expires_at > now()
      and exists (
        select 1 from organisation_feature f
        where f.organisation_id = c.organisation_id and f.feature = 'bulk_actions' and f.enabled
      )
      and not exists (
        select 1 from bulk_listing_child r
        where r.organisation_id = c.organisation_id and r.location_id = c.location_id
          and r.resource_key = c.resource_key and r.status = 'running'
      )
      and not exists (
        select 1 from bulk_listing_child d
        where d.id = any(c.depends_on) and d.status in ('previewed', 'queued', 'running')
      )
      and not exists (
        select 1 from bulk_listing_child d
        where d.id = any(c.requires_applied) and d.status <> 'succeeded'
      )
  ), one_per_resource as (
    select distinct on (due.organisation_id, due.location_id, due.resource_key) due.*
    from due
    order by due.organisation_id, due.location_id, due.resource_key, due.due_at, due.id
  ), busy as (
    select r.organisation_id, count(*)::int as n
    from bulk_listing_child r where r.status = 'running' group by r.organisation_id
  ), ranked as (
    select p.id, p.due_at, coalesce(busy.n, 0) as running,
      row_number() over (partition by p.organisation_id order by p.due_at, p.id) as rn
    from one_per_resource p left join busy on busy.organisation_id = p.organisation_id
  ), chosen as (
    select ranked.id from ranked where ranked.rn <= v_per_org - ranked.running order by ranked.due_at, ranked.id limit p_limit
  )
  update bulk_listing_child c set status = 'running', attempts = c.attempts + 1, started_at = now(),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    mutation_operation_id = null, hours_restore = null
  from chosen where c.id = chosen.id
  returning c.organisation_id, c.id;
end $$;
revoke all on function claim_due_bulk_children(integer, integer, integer) from public;
grant execute on function claim_due_bulk_children(integer, integer, integer) to naba_app_runtime;

insert into schema_migration(version) values ('0126_bulk_multi_item_batches') on conflict (version) do nothing;
commit;
