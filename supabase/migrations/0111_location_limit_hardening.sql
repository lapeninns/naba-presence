begin;

-- ---------------------------------------------------------------------------
-- 0111: location limit hardening (plan P07-S3 review fixes).
--
-- 1. billable_location_count(uuid) is SECURITY DEFINER and takes any
--    organisation id, so granting it to naba_app_runtime let a runtime
--    connection read another tenant's linked-location count past RLS. Only
--    the location_link_enforce_limit trigger (itself SECURITY DEFINER, run
--    as the owner) needs it; the app counts its own links under RLS
--    (lib/server/entitlement-policy.ts assertNewLocationSeat). The grant is
--    revoked.
--
-- 2. A missing organisation_billing row now matches the app
--    (entitlement-policy enforcementApplies: a missing record never grants
--    anything). When the app's tenant transaction says enforcement is on
--    (app.billing_enforcement = 'on'), an organisation with no billing row
--    has a limit of 0. With no setting at all (an operator connection, a
--    script, a migration) there is no per-organisation flag to read either,
--    so the link passes. 0109 seeds a row for every organisation, so this is
--    a belt-and-braces case.
--
-- The env hard override reaches this trigger only through
-- app.billing_enforcement, which withTenant sets (lib/server/db.ts). Writes
-- outside withTenant follow the organisation's own enforcement_enabled flag
-- alone; an operator who must link past the limit runs
-- `set local app.billing_enforcement = 'off'` in that transaction
-- (docs/runbook.md).
-- ---------------------------------------------------------------------------

revoke execute on function billable_location_count(uuid) from naba_app_runtime;

create or replace function location_link_enforce_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_setting text := current_setting('app.billing_enforcement', true);
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
  -- The env hard override, as the app's tenant transaction recorded it.
  if v_setting = 'off' then
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

  if not found then
    -- No record: enforced (limit 0) only when the app said enforcement is on.
    if v_setting is distinct from 'on' then
      return new;
    end if;
    v_state := null;
    v_limit := null;
    v_pending_limit := null;
  elsif not v_enforced or v_state = 'pilot' then
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

revoke all on function location_link_enforce_limit() from public;

insert into schema_migration (version) values ('0111_location_limit_hardening')
on conflict (version) do nothing;

commit;
