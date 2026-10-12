begin;

-- ---------------------------------------------------------------------------
-- 0227: the organisation's open Stripe Checkout session (plan P07-S5).
--
-- An owner starts a subscription through Stripe Checkout
-- (POST /api/billing/checkout, lib/server/billing/checkout.ts). Two tabs, a
-- double click or a retry must not leave two payable sessions open: each
-- completed session would start its own subscription. Stripe idempotency
-- keys alone cannot stop that once the owner picks a different plan, so the
-- one open session is recorded here, under the billing row lock the route
-- already takes: a second request for the same plan reuses it, and a request
-- for another plan expires it at Stripe before creating the next.
--
-- The session's URL is not stored (it is fetched from Stripe when reused),
-- and nothing here grants anything: the subscription only takes effect when
-- the webhook processor (P07-S4) reads it back from Stripe.
-- ---------------------------------------------------------------------------

set local lock_timeout = '5s';

alter table organisation_billing
  add column checkout_session_id text unique
    check (
      checkout_session_id is null
      or checkout_session_id ~ '^cs_(test|live)_[A-Za-z0-9]{1,250}$'
    ),
  add column checkout_plan_id uuid references billing_plan (id),
  add column checkout_expires_at timestamptz,
  add constraint organisation_billing_checkout_complete check (
    (checkout_session_id is null) = (checkout_plan_id is null)
    and (checkout_session_id is null) = (checkout_expires_at is null)
  );

create index organisation_billing_checkout_plan_idx
  on organisation_billing (checkout_plan_id)
  where checkout_plan_id is not null;

insert into schema_migration (version) values ('0227_billing_checkout_session')
on conflict (version) do nothing;

commit;
