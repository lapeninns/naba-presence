begin;

-- ---------------------------------------------------------------------------
-- 0221: billing records must say when paid access ends (plan P07-S1 review).
--
-- An active subscription with no current_period_end would read as full
-- access forever, and a failed renewal with no grace_ends_at leaves nothing
-- safe to count grace from: the period columns mirror the provider's
-- subscription period, which Stripe advances at renewal whatever the payment
-- outcome, so current_period_end is the end of the new, unpaid period.
-- deriveAccess (lib/domain/entitlements.ts) fails closed on both; these
-- checks keep the processor from writing them. A failed FIRST payment has
-- no grace, so it needs no grace end.
--
-- No existing rows are affected: 0220 created the table and only backfilled
-- pilot rows.
-- ---------------------------------------------------------------------------

alter table organisation_billing
  add constraint organisation_billing_active_period_end_check
  check (state <> 'active' or current_period_end is not null);

alter table organisation_billing
  add constraint organisation_billing_grace_end_check
  check (
    state not in ('past_due', 'grace')
    or not first_payment_succeeded
    or grace_ends_at is not null
  );

insert into schema_migration (version) values ('0221_billing_period_checks')
on conflict (version) do nothing;

commit;
