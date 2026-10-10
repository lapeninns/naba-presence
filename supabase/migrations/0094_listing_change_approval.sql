begin;

-- ---------------------------------------------------------------------------
-- Two-person approval for direct listing writes (plan P02-S2b).
--
-- Posts and replies already honour organisation.require_two_person_approval
-- (0039, 0062). Direct listing writes -- hours, profile, business
-- information, attributes, industry, food menus, media and place-action
-- links -- went straight to Google whoever sent them. With the policy on and
-- the organisation's `listing_change_approvals` feature switched on
-- (organisation_feature, 0090), a publisher's listing write is no longer sent:
-- it is frozen as a change request and a different publisher approves that
-- exact request, which then dispatches it through runGbpWrite
-- (lib/server/listing-changes.ts).
--
-- A change request IS a mutation_operation receipt (0086), so the client
-- that sent it can poll GET /api/mutations/{id} like any other write:
--
--   state 'awaiting_approval'  new: parked, nothing sent. Approval moves it
--                              to 'sent' and it then follows the dispatch's
--                              attempt (attempt_table/attempt_id), so the
--                              attempt's settle -- or the recovery job --
--                              settles it too. A rejection, a withdrawal or
--                              a newer request for the same change settles
--                              it 'failed' with error_code saying which.
--   change_request             the frozen request: {kind, target, body}, the
--                              exact body the route validated. Approval
--                              dispatches this, never a re-read of the page.
--   field_mask                 what the request writes, for the approver.
--   payload_hash               (existing) sha256 of the frozen request; the
--                              approver names it, so an approval can only
--                              cover the request that was shown.
--   expected_revision          (existing) the baseline the author edited
--                              against; the surface's own freshness check
--                              refuses a dispatch whose baseline moved.
--   approval_ref               (existing) the approving decision's id.
--
-- mutation_approval_decision mirrors post_approval_decision (0062): one row
-- per decision on a change request, naming the payload hash it covered, the
-- requester and the decider. The CHECK makes self-approval unrepresentable
-- rather than merely refused. Reusable by later approval flows (bulk listing
-- changes, plan P09) because it keys on the receipt, not on a surface table.
-- ---------------------------------------------------------------------------

alter table mutation_operation
  drop constraint if exists mutation_operation_state_check;
alter table mutation_operation
  add constraint mutation_operation_state_check check (
    state in (
      'saved_locally',
      'awaiting_approval',
      'sent',
      'awaiting_confirmation',
      'confirmed_applied',
      'rejected',
      'failed',
      'uncertain'
    )
  );

alter table mutation_operation
  add column change_request jsonb
    check (change_request is null or jsonb_typeof(change_request) = 'object'),
  add column field_mask text[]
    check (field_mask is null or cardinality(field_mask) <= 64);

-- Only a change request may wait for approval.
alter table mutation_operation
  add constraint mutation_operation_awaiting_approval_request check (
    state <> 'awaiting_approval' or change_request is not null
  );

-- The tenant key mutation_approval_decision references: a decision can only
-- name a receipt of its own organisation, whatever RLS the writer runs under.
alter table mutation_operation
  add constraint mutation_operation_organisation_id_id_key
  unique (organisation_id, id);

-- The pending requests of one location, for the editors' approval panel and
-- for superseding an older request when a newer one arrives.
create index mutation_operation_pending_change_idx
  on mutation_operation (organisation_id, location_id, surface)
  where state = 'awaiting_approval';

create table mutation_approval_decision (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  operation_id uuid not null,
  payload_hash text not null check (length(payload_hash) between 16 and 128),
  requested_by uuid references app_user(id) on delete set null,
  decided_by uuid references app_user(id) on delete set null,
  decision text not null check (decision in ('approved', 'rejected')),
  note text check (note is null or length(note) <= 2000),
  created_at timestamptz not null default now(),
  foreign key (organisation_id, operation_id)
    references mutation_operation (organisation_id, id) on delete cascade,
  check (decided_by <> requested_by)
);

create index mutation_approval_decision_operation_idx
  on mutation_approval_decision (organisation_id, operation_id);

alter table mutation_approval_decision enable row level security;
alter table mutation_approval_decision force row level security;
create policy tenant_isolation on mutation_approval_decision
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );

-- Decisions are a record: the runtime role writes and reads them, never
-- rewrites or deletes one.
grant select, insert on mutation_approval_decision to naba_app_runtime;

insert into schema_migration (version)
values ('0094_listing_change_approval')
on conflict (version) do nothing;

commit;
