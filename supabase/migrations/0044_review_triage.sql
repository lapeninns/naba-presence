begin;

-- ---------------------------------------------------------------------------
-- Review triage: assignment and "reviewed without replying".
--
-- Two gaps the agency inbox exposes.
--
--   1. There is no way to hand a review to a colleague. The old UI had an
--      "escalate" action backed by an `escalated` workflow state, which
--      0042_remove_escalated_workflow_state.sql removed because a state that
--      only meant "someone should look" duplicated the queue it already sat
--      in. Assignment is the honest version of that action: it names WHO,
--      keeps the review in its real workflow state, and gives the inbox an
--      "assigned to me" filter.
--
--   2. A five-star review with no text needs no reply, but the only way to
--      clear it from Needs reply was to publish something. `triaged_at`
--      records the human decision to leave it alone, so the queue can empty
--      honestly.
-- ---------------------------------------------------------------------------

alter table review
  add column assigned_to uuid references app_user(id) on delete set null,
  add column assigned_at timestamptz,
  add column triaged_at timestamptz,
  add column triaged_by uuid references app_user(id) on delete set null;

-- The inbox filters by assignee within one organisation, and the "assigned to
-- me" queue is the hot path.
create index review_assigned_idx
  on review (organisation_id, assigned_to)
  where assigned_to is not null;

-- Needs-reply excludes triaged rows, so the partial index matches the query.
create index review_triaged_idx
  on review (organisation_id, triaged_at)
  where triaged_at is not null;

insert into schema_migration (version) values ('0044_review_triage')
on conflict (version) do nothing;

commit;
