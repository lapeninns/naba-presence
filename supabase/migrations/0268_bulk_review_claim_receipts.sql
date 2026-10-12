begin;

-- P09-R8 review fixes.
--
--   * A claim clears the previous claim's publish attempt as well as its
--     mutation receipt (0262), so a review child is only ever settled from
--     the attempt its latest run started. Without it a retried child kept
--     the failed attempt of its previous run: interrupted by a lease
--     reclaim, it settled from that old attempt (bulk_children_to_reconcile)
--     before requeue_interrupted_review_children could run it again.
--   * bulk_listing_child.review_id gets an index of its own for the
--     `on delete set null` action of review deletes.

create index bulk_listing_child_review_idx
  on bulk_listing_child (review_id)
  where review_id is not null;

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
    mutation_operation_id = null, publish_attempt_id = null, hours_restore = null
  from chosen where c.id = chosen.id
  returning c.organisation_id, c.id;
end $$;
revoke all on function claim_due_bulk_children(integer, integer, integer) from public;
grant execute on function claim_due_bulk_children(integer, integer, integer) to naba_app_runtime;

insert into schema_migration(version) values ('0268_bulk_review_claim_receipts') on conflict (version) do nothing;
commit;
