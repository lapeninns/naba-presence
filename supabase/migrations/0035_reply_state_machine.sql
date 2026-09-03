begin;

-- ---------------------------------------------------------------------------
-- Reply attempt state machine: supersession, and the generation it is keyed to.
--
-- 'superseded' is the state a queued attempt needs when the mutation it was
-- keyed to is no longer the one the reply wants: a delete parked on a 429
-- while the operator publishes new text, or a publish intent withdrawn by a
-- local cancel. Settling those as 'failed' would keep the runner away from
-- them (every claim predicate is an allowlist), but 'failed' is a provider
-- verdict -- resolveExistingPublishAttempt answers it with a permanent 409
-- 'previous_publish_failed', so re-publishing the same body under the same
-- idempotency key would then be refused forever. 'superseded' carries no
-- verdict, so the row stays re-armable exactly like the 'retryable' row it
-- replaced.
--
-- publish_attempt.publish_generation pins the review_reply generation the
-- attempt was created against. applyDeletedReply bumps that counter, so a
-- claim whose recorded generation no longer matches the reply is provably
-- about to replay a mutation for a reply that has since been replaced.
-- Existing rows are backfilled from the reply they point at; a null means the
-- row predates this column (written by an old deploy mid-rollout) and the
-- claim skips that half of its check.
-- ---------------------------------------------------------------------------

alter table publish_attempt
  drop constraint if exists publish_attempt_status_check;

alter table publish_attempt
  add constraint publish_attempt_status_check
  check (
    status in (
      'started',
      'accepted',
      'succeeded',
      'retryable',
      'failed',
      'ambiguous',
      'superseded'
    )
  );

alter table publish_attempt
  add column if not exists publish_generation integer;

update publish_attempt pa
set publish_generation = rr.publish_generation
from review_reply rr
where rr.id = pa.review_reply_id
  and pa.publish_generation is null;

-- Both the supersede sweep and the delete path's active-attempt lookup read
-- every attempt belonging to one reply, and the foreign key carries no index
-- of its own.
create index if not exists publish_attempt_reply_idx
  on publish_attempt (review_reply_id, status);

insert into schema_migration (version)
values ('0035_reply_state_machine')
on conflict (version) do nothing;

commit;
