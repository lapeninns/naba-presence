begin;

-- ---------------------------------------------------------------------------
-- 0142: the retention `media` step honours a hold committed mid-round
-- (follow-up to 0141, audit 2026-10-14 R2B-01).
--
-- The `media` step (lib/server/retention/purge.ts) deletes the
-- review_media_item rows of reviews whose raw content has expired and that
-- carry no active hold. Like the other steps before 0141, it read that hold
-- against its own statement snapshot, and nothing made it wait for a hold
-- being applied: a delete of review_media_item never touches the review row,
-- so the FOR NO KEY UPDATE that legal_hold_lock_review (0141) takes on the
-- review did not stop it. A hold committed while the step ran therefore lost
-- that review's media, though not its text or the hold itself.
--
-- review_media_legal_hold_guard closes that the same way 0141 does for the
-- review: for a delete issued directly by a retention round
-- (app.retention_run, pg_trigger_depth() = 1), it first takes FOR SHARE on
-- the parent review. That conflicts with the hold's FOR NO KEY UPDATE, so a
-- hold being applied makes the delete wait for it; the hold check that
-- follows takes a fresh snapshot (READ COMMITTED) and sees the committed
-- hold, and the row is skipped. The share lock is kept to the end of the
-- round's transaction, so a hold applied afterwards waits for the round and
-- comes after the media went, which is the order things happened in.
--
-- Nothing else changes. A cascade from a review delete is already decided
-- by review_legal_hold_guard on the review (depth > 1 here), and media
-- written or replaced by sync or erasure (not a retention round) are
-- outside the WHEN clause, so they pay nothing.
--
-- Expand-only: the live code sets app.retention_run for every round already.
-- ---------------------------------------------------------------------------

create or replace function review_media_legal_hold_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  perform 1
  from review r
  where r.organisation_id = old.organisation_id
    and r.id = old.review_id
  for share;
  if exists (
    select 1
    from legal_hold h
    where h.organisation_id = old.organisation_id
      and h.review_id = old.review_id
      and h.released_at is null
  ) then
    return null;
  end if;
  return old;
end;
$$;

revoke all on function review_media_legal_hold_guard() from public;

create trigger review_media_legal_hold_guard
  before delete on review_media_item
  for each row
  when (current_setting('app.retention_run', true) = 'true')
  execute function review_media_legal_hold_guard();

insert into schema_migration (version)
values ('0142_retention_media_hold_guard')
on conflict (version) do nothing;

commit;
