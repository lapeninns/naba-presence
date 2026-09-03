begin;

-- ---------------------------------------------------------------------------
-- Remove the `escalated` review workflow state.
--
-- It has been in the CHECK constraint and in ALLOWED_TRANSITIONS since 0001,
-- and nothing has ever written it: no route, no domain module, no job, no
-- provider reconciliation path. What it did have was a full set of READ
-- surfaces -- an "Escalated" inbox queue tab, a home work-queue row with its
-- own icon and description, a situation label, and a `?queue=escalated` URL
-- -- so every operator saw a tab and a counter that were permanently empty
-- and could never be anything else.
--
-- Dead vocabulary with live surfaces is worse than no vocabulary: it tells
-- every future reader that an escalation workflow exists. The same call was
-- made for `gbp_local_post.scheduled_publish_time` in 0037's release.
--
-- The state is dropped rather than given a writer because nothing in the
-- product defines what escalation would mean -- who escalates, on what
-- trigger, and what changes as a result. When that is specified, the state
-- comes back with a writer in the same change.
--
-- Safe to narrow: `escalated` is unreachable, so no row can hold it. The
-- guard below turns a surprise into a clear failure rather than a silent
-- constraint violation at the ALTER.
-- ---------------------------------------------------------------------------

do $$
declare
  stranded integer;
begin
  select count(*) into stranded from review where workflow_status = 'escalated';
  if stranded > 0 then
    raise exception
      'Cannot drop the escalated workflow state: % review row(s) still hold it. '
      'Move them to a live state first (drafted is the usual target).', stranded;
  end if;
end
$$;

alter table review
  drop constraint if exists review_workflow_status_check;

alter table review
  add constraint review_workflow_status_check check (
    workflow_status in (
      'new', 'drafted', 'verified', 'awaiting_approval',
      'publish_requested', 'published', 'rejected', 'failed'
    )
  );

-- enforce_review_workflow_transition (0006) never named `escalated` in its
-- allowed set, so the trigger needs no change: it validates only the
-- publish_requested transitions.

insert into schema_migration (version)
values ('0042_remove_escalated_workflow_state')
on conflict (version) do nothing;

commit;
