begin;

-- ---------------------------------------------------------------------------
-- 0228: audited AI credit adjustments (plan P07-S7).
--
-- Before this, the only manual lever was organisation.ai_monthly_draft_credits:
-- one value, overwritten in place, with no history and only for pilots. A
-- support grant is now its own ai_credit_period row of kind 'adjustment'
-- (the kind exists since 0220), written by the operator route
-- POST /api/operations/organisations/{id}/ai-credits. Each row records:
--
-- - applies_to_period_id: the base period (pilot month, trial or paid
--   period) it adds to. The ledger (lib/server/ai-credits.ts) adds the
--   allowance of every adjustment of the current period to that period's
--   allowance. Used credits are never touched, so a grant can only add, and
--   it ends with its period: the next period starts from its own allowance.
-- - reason and granted_by: why, and who. The cron bearer the route uses is a
--   shared secret with no identity, so the operator names themself; the
--   same values go into the audit log.
--
-- An adjustment always names a base period of its own organisation (the
-- composite tenant key 0220 added), never another adjustment, and grants at
-- least one credit. Rows stay append-only for the runtime (0220 grants
-- select and insert; 0225's ends_at column grant cannot move an
-- adjustment's window, 0226). No existing row is an adjustment: nothing
-- wrote that kind before this migration.
-- ---------------------------------------------------------------------------

set local lock_timeout = '5s';

alter table ai_credit_period
  add column applies_to_period_id uuid,
  add column reason text
    check (reason is null or length(reason) between 10 and 500),
  add column granted_by text
    check (granted_by is null or length(granted_by) between 3 and 120),
  add constraint ai_credit_period_applies_to_fkey
    foreign key (organisation_id, applies_to_period_id)
    references ai_credit_period (organisation_id, id)
    on delete cascade,
  add constraint ai_credit_period_adjustment_shape check (
    (kind = 'adjustment') = (
      applies_to_period_id is not null
      and reason is not null
      and granted_by is not null
      and allowance is not null
      and allowance >= 1
    )
  );

create index ai_credit_period_applies_to_idx
  on ai_credit_period (applies_to_period_id)
  where applies_to_period_id is not null;

-- An adjustment adds to a base period, never to another adjustment (the
-- ledger would not count it).
create function ai_credit_period_adjustment_target()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind = 'adjustment' and exists (
    select 1 from ai_credit_period p
    where p.organisation_id = new.organisation_id
      and p.id = new.applies_to_period_id
      and p.kind = 'adjustment'
  ) then
    raise exception 'ai_credit_adjustment_target_invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function ai_credit_period_adjustment_target() from public;

create trigger ai_credit_period_adjustment_target
before insert or update of applies_to_period_id, kind on ai_credit_period
for each row execute function ai_credit_period_adjustment_target();

insert into schema_migration (version) values ('0228_ai_credit_adjustments')
on conflict (version) do nothing;

commit;
