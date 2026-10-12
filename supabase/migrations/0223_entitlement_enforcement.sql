begin;

-- ---------------------------------------------------------------------------
-- 0223: central entitlement enforcement (plan P07-S3).
--
-- Enforcement is off unless BOTH switches are on:
--   - BILLING_ENFORCEMENT_ENABLED, the env hard override (default off). The
--     app's tenant transaction (lib/server/db.ts withTenant) records it as
--     the transaction-local setting app.billing_enforcement = 'on' | 'off';
--   - organisation_billing.enforcement_enabled, the per-organisation rollout
--     flag added here (default off, so every organisation that exists keeps
--     behaving exactly as before).
-- The routes and the job runner read both in the app
-- (lib/server/entitlement-policy.ts). This migration adds the one check that
-- has to hold for every writer: the location limit.
--
-- The location limit counts distinct linked Google locations: active
-- location_link rows. A link whose Google connection has expired or been
-- revoked is still active and still counts until someone unlinks it. A
-- disconnect deactivates its links (lib/server/google/connections.ts), and
-- reactivating any link goes back through this trigger, so the count can
-- never pass the limit by disconnecting and reconnecting.
--
-- The trigger only ever refuses a NEW active link: an insert, or an update
-- that turns an inactive link active. It never touches existing links, so a
-- downgrade or a lower pending plan never unlinks anything; it only stops
-- new links until the organisation is back under the limit. Re-linking a
-- Google location that is already actively linked takes no new seat and
-- passes.
--
-- The limit is the lower of the current plan's and the scheduled plan's
-- (a downgrade binds new links at once), as lib/domain/entitlements.ts
-- deriveAccess newLinkLimit computes it. A pilot has no limit. A
-- subscription state with no plan has a limit of 0 (fails closed).
--
-- The organisation's billing row is locked FOR UPDATE before counting, so
-- two concurrent links cannot both take the last seat.
--
-- SECURITY DEFINER, like the membership triggers in 0031: the count must see
-- every link of the organisation whatever RLS context the writer runs in
-- (an operator connection carries no app.organisation_id).
-- ---------------------------------------------------------------------------

alter table organisation_billing
  add column enforcement_enabled boolean not null default false;

create function billable_location_count(p_organisation_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct external_location_id)::integer
  from location_link
  where organisation_id = p_organisation_id
    and is_active
$$;

create function location_link_enforce_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
  v_enforced boolean;
  v_limit integer;
  v_pending_limit integer;
  v_effective integer;
begin
  if not new.is_active then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.is_active then
    return new;
  end if;
  -- The env hard override, as the app's tenant transaction recorded it. No
  -- setting at all (an operator script, a migration) leaves the
  -- per-organisation flag in charge.
  if current_setting('app.billing_enforcement', true) = 'off' then
    return new;
  end if;

  select
    b.state,
    b.enforcement_enabled,
    p.location_limit,
    case when b.pending_effective_at is not null then pp.location_limit end
  into v_state, v_enforced, v_limit, v_pending_limit
  from organisation_billing b
  left join billing_plan p on p.id = b.plan_id
  left join billing_plan pp on pp.id = b.pending_plan_id
  where b.organisation_id = new.organisation_id
  for update of b;

  if not found or not v_enforced or v_state = 'pilot' then
    return new;
  end if;

  -- Already linked elsewhere in the organisation: no new seat.
  if exists (
    select 1
    from location_link
    where organisation_id = new.organisation_id
      and external_location_id = new.external_location_id
      and is_active
      and id <> new.id
  ) then
    return new;
  end if;

  v_effective := coalesce(least(v_limit, v_pending_limit), 0);
  if billable_location_count(new.organisation_id) >= v_effective then
    raise exception 'location_limit_reached'
      using errcode = '23514', detail = v_effective::text;
  end if;
  return new;
end;
$$;

create trigger location_link_enforce_limit
  before insert or update of is_active on location_link
  for each row execute function location_link_enforce_limit();

revoke all on function billable_location_count(uuid) from public;
revoke all on function location_link_enforce_limit() from public;
grant execute on function billable_location_count(uuid) to naba_app_runtime;

insert into schema_migration (version) values ('0223_entitlement_enforcement')
on conflict (version) do nothing;

commit;
