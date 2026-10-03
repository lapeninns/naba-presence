begin;

-- ---------------------------------------------------------------------------
-- AI usage ledger (phase A1 of docs/specs/2026-10-03-business-mode-and-ai-credits.md).
--
-- One row per provider call that wrote or checked a reply. This migration
-- only records cost; nothing reads it to limit a call yet. The row holds no
-- review text, so the 30-day raw-content purge does not apply (keep 13
-- months). review_id and draft_id carry no foreign key: reviews are erased on
-- retention and the cost history must outlive them.
-- ---------------------------------------------------------------------------

create table ai_usage (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  kind text not null check (kind in ('draft', 'verify')),
  status text not null check (status in ('reserved', 'settled', 'released')),
  credits integer not null default 0 check (credits >= 0),
  model text not null,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  review_id uuid,
  draft_id uuid,
  request_id text,
  user_id uuid references app_user(id) on delete set null,
  period_start date not null,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create index ai_usage_period_idx
  on ai_usage (organisation_id, period_start, kind, status);

-- One row per provider call: a re-run settle step or a retried request must
-- not double-record. Rows without a request_id are not constrained.
create unique index ai_usage_request_uidx
  on ai_usage (organisation_id, kind, request_id)
  where request_id is not null;

alter table ai_usage enable row level security;
alter table ai_usage force row level security;
create policy tenant_isolation on ai_usage
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );

grant select, insert, update on ai_usage to naba_app_runtime;

-- null = use AI_MONTHLY_DRAFT_CREDITS (not read until the limits PR).
alter table organisation add column ai_monthly_draft_credits integer
  check (ai_monthly_draft_credits is null or ai_monthly_draft_credits >= 0);

insert into schema_migration (version)
values ('0059_ai_credits') on conflict (version) do nothing;
commit;
