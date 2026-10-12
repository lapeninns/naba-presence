begin;

-- ---------------------------------------------------------------------------
-- 0109: billing integrity the database guarantees (plan P07-S1 review).
--
-- Fail fast instead of queueing live traffic behind this migration: every
-- statement below locks organisation or organisation_billing.
set local lock_timeout = '5s';

-- 1. Every organisation has a billing row.
--
-- 0107 backfilled the organisations that existed when it ran, and the new
-- provisioning code seeds a row for each organisation it creates. An
-- organisation created by the previous app release between 0107 being
-- applied and the new code being deployed got neither, and deriveAccess
-- reads a missing row as read-only (billing_missing). This trigger makes the
-- row part of creating an organisation, whatever code does it, and the
-- backfill below catches any organisation created in that window.
-- seedPilotBilling stays (on conflict do nothing), so either can run first.
--
-- SECURITY DEFINER, like the membership triggers in 0031: organisation_billing
-- has FORCE RLS and an operator insert carries no app.organisation_id.
-- ---------------------------------------------------------------------------

create function organisation_seed_pilot_billing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into organisation_billing (organisation_id, state)
  values (new.id, 'pilot')
  on conflict (organisation_id) do nothing;
  return null;
end;
$$;

create trigger organisation_seed_pilot_billing
  after insert on organisation
  for each row execute function organisation_seed_pilot_billing();

revoke all on function organisation_seed_pilot_billing() from public;

-- Organisations created since 0107 by code that did not seed a row. Runs as
-- the migration owner, which is not subject to the tenant policy.
insert into organisation_billing (organisation_id, state)
select o.id, 'pilot'
from organisation o
where not exists (
  select 1 from organisation_billing b where b.organisation_id = o.id
)
on conflict (organisation_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. A subscription's plans belong to its environment and workspace mode.
--
-- Without this a live subscription row could name a test-environment plan
-- (always a test offer) or a plan for the other workspace mode and still
-- derive full access. The processor and checkout (P07-S4) validate the same
-- under the billing lock; this is the backstop for every writer. It checks
-- the current and the scheduled plan whenever a subscription state, either
-- plan or the environment is written. A pilot, read-only or canceled record
-- is not checked: it grants no plan entitlements, and an organisation that
-- switched workspace mode after its subscription ended keeps its history.
-- ---------------------------------------------------------------------------

create function organisation_billing_plan_matches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_plan record;
begin
  if new.state not in ('trialing', 'active', 'past_due', 'grace') then
    return new;
  end if;

  select workspace_mode into v_mode
  from organisation
  where id = new.organisation_id;

  for v_plan in
    select p.id, p.environment, p.workspace_mode
    from billing_plan p
    where p.id in (new.plan_id, new.pending_plan_id)
  loop
    if v_plan.environment is distinct from new.environment then
      raise exception 'billing_plan_environment_mismatch'
        using errcode = '23514',
          detail = format('plan %s is %s, subscription is %s',
            v_plan.id, v_plan.environment, coalesce(new.environment, 'unset'));
    end if;
    if v_plan.workspace_mode is distinct from v_mode then
      raise exception 'billing_plan_workspace_mode_mismatch'
        using errcode = '23514',
          detail = format('plan %s is for %s, organisation is %s',
            v_plan.id, v_plan.workspace_mode, coalesce(v_mode, 'unknown'));
    end if;
  end loop;
  return new;
end;
$$;

create trigger organisation_billing_plan_matches
  before insert or update of state, plan_id, pending_plan_id, environment
  on organisation_billing
  for each row execute function organisation_billing_plan_matches();

revoke all on function organisation_billing_plan_matches() from public;

insert into schema_migration (version) values ('0109_billing_integrity')
on conflict (version) do nothing;

commit;
