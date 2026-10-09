begin;

-- ---------------------------------------------------------------------------
-- Background work reaches every organisation.
--
-- Production has no scheduler process; Vercel Cron fires one GET per tick and
-- nothing followed the `nextCursor` a page returns. Every tick therefore
-- restarted at the head of the tenant order, and the daily sweep ran with
-- maxOrganisations=1: one organisation was ever swept.
--
-- Two pieces:
--
--   cron_cursor                 where each cursor-walked tick stopped, so
--                               the next fire resumes there instead of at
--                               the head. Platform-level, like ops_heartbeat.
--
--   enqueue_sweep_checkpoints   the daily sweep as a queue. One cross-tenant
--                               statement arms a 'sweep' sync_checkpoint for
--                               every linked location in every organisation,
--                               and the job runner (claim_due_jobs, every
--                               minute) works through them under its own
--                               per-organisation fairness and time budget.
-- ---------------------------------------------------------------------------

-- `attempts` counts fires that started from this cursor without finishing.
-- A page cut off by the platform (maxDuration) never stores its result, so
-- without it the walk would re-enter the same poisoned page forever and starve
-- everything after it; after a few such fires the walk restarts at the head.
create table cron_cursor (
  name text primary key,
  organisation_cursor uuid,
  attempts integer not null default 0,
  updated_at timestamptz not null default now()
);

grant select, insert, update on cron_cursor to naba_app_runtime;

-- SECURITY DEFINER for the same reason as claim_due_jobs: RLS scopes a tenant
-- transaction to one organisation, and arming the fleet one tenant
-- transaction at a time is O(organisations) round trips for one decision.
-- It writes routing state only (status, next_attempt_at); every review read
-- and write still happens in the runner, inside withTenant() under RLS.
--
-- Which rows it touches:
--   * no sweep checkpoint yet                 -> insert, due now
--   * succeeded or cancelled, finished before
--     p_min_interval ago (or never)           -> pending, due now
--   * parked (pending/failed, next_attempt_at
--     null): a sweep that ran out of pages     -> due now, cursor kept, so it
--                                                 resumes where it stopped
-- and never: a running claim, a row already due or backing off, or 'dead'
-- (a permanent failure a person has to look at).
create or replace function enqueue_sweep_checkpoints(p_min_interval interval)
returns table (organisation_count integer, queued integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with eligible as (
    select distinct e.organisation_id, e.id as external_location_id
    from location_link ll
    join external_location e on e.id = ll.external_location_id
    join google_connection gc on gc.id = e.google_connection_id
    where ll.is_active
      and gc.status in ('active', 'expired')
  ),
  inserted as (
    insert into sync_checkpoint (
      organisation_id, external_location_id, sync_type, status, next_attempt_at
    )
    select organisation_id, external_location_id, 'sweep', 'pending', now()
    from eligible
    on conflict (organisation_id, external_location_id, sync_type) do update
      set status = case
            when sync_checkpoint.status in ('succeeded', 'cancelled')
              then 'pending'
            else sync_checkpoint.status
          end,
          next_attempt_at = now()
      where sync_checkpoint.next_attempt_at is null
        and (
          (
            sync_checkpoint.status in ('succeeded', 'cancelled')
            and (
              sync_checkpoint.finished_at is null
              or sync_checkpoint.finished_at < now() - p_min_interval
            )
          )
          or sync_checkpoint.status in ('pending', 'failed')
        )
    returning organisation_id
  )
  select count(distinct organisation_id)::integer, count(*)::integer
  from inserted;
end;
$$;

revoke all on function enqueue_sweep_checkpoints(interval) from public;
grant execute on function enqueue_sweep_checkpoints(interval) to naba_app_runtime;

insert into schema_migration (version) values ('0046_cron_fleet_coverage')
on conflict (version) do nothing;

commit;
