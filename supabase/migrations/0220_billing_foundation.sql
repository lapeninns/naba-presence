begin;

-- ---------------------------------------------------------------------------
-- Billing foundation (plan P07-S1): plan catalog, organisation billing state
-- and AI credit periods. Schema and read model only: nothing reads these to
-- refuse work yet (central enforcement is P07-S3), so the app behaves as
-- before.
--
-- billing_plan is the versioned commercial catalog. Platform-level like
-- ops_pause_control (0090): no tenant data, every row readable by the
-- runtime, written only from the operator connection. A published version
-- never changes its terms: the only column an update may touch is `active`
-- (billing_plan_terms_immutable below), so a price or limit change is a new
-- version and an organisation's plan_id keeps meaning what it meant when it
-- was chosen. An active plan must name its Stripe price, and a plan in the
-- Stripe test environment is always a test offer, so the UI can mark it.
-- The migration seeds no plans: catalog values are an owner decision, and
-- with no active plan nothing can be sold (fails closed).
--
-- organisation_billing is one row per organisation. Every organisation that
-- exists when this runs is backfilled as an explicit 'pilot': pilots keep
-- their access and calendar-month allowance until an owner converts, and are
-- never charged. New organisations get the same row from provisioning
-- (lib/server/billing/state.ts seedPilotBilling). An organisation with no row
-- derives read-only access (lib/domain/entitlements.ts deriveAccess): a
-- missing record never grants anything.
--
-- ai_credit_period is one allowance grant: a pilot month, a trial, a paid
-- period or an operator adjustment. `allowance` null means unknown and stays
-- unknown; source_ref (the pilot month, the Stripe subscription/invoice id,
-- an adjustment id) makes each grant idempotent per organisation and kind,
-- so a replayed webhook cannot grant twice. This migration grants nothing:
-- it inserts no periods, and existing ai_usage rows keep a null
-- credit_period_id. ai_usage links to its period through a composite
-- tenant FK, so a usage row can only ever name a period of its own
-- organisation.
-- ---------------------------------------------------------------------------

create table billing_plan (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z][a-z0-9_]{0,63}$'),
  version integer not null check (version >= 1),
  workspace_mode text not null check (workspace_mode in ('business', 'agency')),
  environment text not null check (environment in ('test', 'live')),
  name text not null check (length(name) between 1 and 120),
  stripe_price_id text unique
    check (stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9]{1,250}$'),
  location_limit integer not null check (location_limit >= 1),
  -- null = no member limit.
  member_limit integer check (member_limit is null or member_limit >= 1),
  ai_draft_credits_per_period integer not null
    check (ai_draft_credits_per_period >= 0),
  is_test_offer boolean not null default false,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (code, version, environment),
  check (environment <> 'test' or is_test_offer),
  check (not active or stripe_price_id is not null)
);

create function billing_plan_terms_immutable()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'active') is distinct from (to_jsonb(old) - 'active') then
    raise exception 'billing_plan terms are immutable; add a new version';
  end if;
  return new;
end;
$$;

create trigger billing_plan_terms_immutable
  before update on billing_plan
  for each row execute function billing_plan_terms_immutable();

alter table billing_plan enable row level security;
create policy billing_plan_read on billing_plan for select using (true);
revoke all on billing_plan from public;
grant select on billing_plan to naba_app_runtime;

create table organisation_billing (
  organisation_id uuid primary key references organisation (id) on delete cascade,
  state text not null check (
    state in (
      'pilot',
      'trialing',
      'active',
      'past_due',
      'grace',
      'read_only',
      'canceled'
    )
  ),
  plan_id uuid references billing_plan (id),
  -- A plan change scheduled for the next billing boundary (no proration).
  pending_plan_id uuid references billing_plan (id),
  pending_effective_at timestamptz,
  stripe_customer_id text unique
    check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,250}$'),
  stripe_subscription_id text unique
    check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9]{1,250}$'),
  environment text check (environment is null or environment in ('test', 'live')),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  first_payment_succeeded boolean not null default false,
  -- The last provider subscription object the processor fetched (P07-S4).
  provider_snapshot jsonb
    check (provider_snapshot is null or jsonb_typeof(provider_snapshot) = 'object'),
  provider_synced_at timestamptz,
  -- Bumped on every change, for compare-and-set writers.
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((pending_plan_id is null) = (pending_effective_at is null)),
  check (
    current_period_start is null
    or current_period_end is null
    or current_period_end > current_period_start
  ),
  -- A pilot has no subscription: converting is what creates one.
  check (state <> 'pilot' or stripe_subscription_id is null),
  -- A live subscription state names its plan, customer, subscription and
  -- environment; a trial says when it ends.
  check (
    state not in ('trialing', 'active', 'past_due', 'grace')
    or (
      plan_id is not null
      and stripe_customer_id is not null
      and stripe_subscription_id is not null
      and environment is not null
    )
  ),
  check (state <> 'trialing' or trial_ends_at is not null)
);

create index organisation_billing_plan_idx on organisation_billing (plan_id);
create index organisation_billing_pending_plan_idx
  on organisation_billing (pending_plan_id)
  where pending_plan_id is not null;

-- Backfill before forcing RLS, so the migration role's insert is not
-- filtered by a tenant context it does not have.
insert into organisation_billing (organisation_id, state)
select id, 'pilot' from organisation
on conflict (organisation_id) do nothing;

alter table organisation_billing enable row level security;
alter table organisation_billing force row level security;
create policy tenant_isolation on organisation_billing
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );

revoke all on organisation_billing from public;
grant select, insert, update on organisation_billing to naba_app_runtime;

create table ai_credit_period (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation (id) on delete cascade,
  kind text not null
    check (kind in ('pilot_month', 'trial', 'paid_period', 'adjustment')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- null = unknown, and stays unknown.
  allowance integer check (allowance is null or allowance >= 0),
  source_ref text not null check (length(source_ref) between 1 and 255),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (organisation_id, kind, source_ref),
  -- The tenant key ai_usage references.
  unique (organisation_id, id)
);

create index ai_credit_period_window_idx
  on ai_credit_period (organisation_id, starts_at, ends_at);

alter table ai_credit_period enable row level security;
alter table ai_credit_period force row level security;
create policy tenant_isolation on ai_credit_period
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );

revoke all on ai_credit_period from public;
grant select, insert on ai_credit_period to naba_app_runtime;

-- No backfill: existing usage keeps a null period (history unchanged).
-- Deleting a period (retention) clears only the link, never the usage row.
alter table ai_usage add column credit_period_id uuid;
alter table ai_usage
  add constraint ai_usage_credit_period_fkey
  foreign key (organisation_id, credit_period_id)
  references ai_credit_period (organisation_id, id)
  on delete set null (credit_period_id);

create index ai_usage_credit_period_idx
  on ai_usage (credit_period_id)
  where credit_period_id is not null;

insert into schema_migration (version) values ('0220_billing_foundation')
on conflict (version) do nothing;

commit;
