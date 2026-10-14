begin;

-- ---------------------------------------------------------------------------
-- 0141: legal holds enforced in the database (audit 2026-10-14, R2B-01).
--
-- Until now a hold was only a `not exists (select 1 from legal_hold ...)`
-- predicate in the app: the retention steps, the privacy erasure and the
-- disconnected-location purge each read it against their own statement
-- snapshot. A hold committed after that snapshot was taken lost:
--
-- - the retention `reviews` step and the erasure redact with a non-key
--   UPDATE, which does not wait on the hold insert's FOR KEY SHARE, so the
--   held review was redacted anyway;
-- - the `disconnectedReviews` DELETE waited on that lock and then went ahead,
--   and legal_hold.review_id ON DELETE CASCADE (0001) deleted the hold that
--   had just been committed with it.
--
-- review_legal_hold_guard runs as a BEFORE trigger, after the row lock is
-- taken, and its query takes a fresh snapshot (READ COMMITTED), so it sees a
-- hold committed while the statement waited. For a review under an active
-- hold it:
--
-- - skips the row (returns NULL) for a statement of the retention purge
--   itself (app.retention_run, set by lib/server/retention/purge.ts), so a
--   hold landing mid-round costs that row, not the tenant's whole round;
-- - raises `review_legal_hold` (SQLSTATE 23514, the review id as detail)
--   for anything else, including a delete cascading from external_location:
--   suppressing a cascaded delete would leave a row pointing at a deleted
--   parent. The privacy erasure maps it to its 409 privacy_legal_hold.
--
-- A review whose organisation is itself being deleted is let through: the
-- holds go with the organisation (legal_hold.organisation_id cascades).
--
-- Only redaction is guarded on UPDATE, not every write: the sync rewrites
-- these columns on every receipt and always writes raw_payload, so the WHEN
-- clause matches the two redaction shapes only, an erasure (erased_at set)
-- or raw_payload going null with the content (the retention `reviews` step).
--
-- The guard cannot see a hold that is not committed yet, and inserting one
-- takes only FOR KEY SHARE on the review (the foreign key check), which a
-- redaction's UPDATE does not wait for. legal_hold_lock_review therefore
-- locks the review FOR NO KEY UPDATE whenever a hold is applied (inserted,
-- or re-applied by the hold route's upsert), from any writer: a redaction
-- that reaches the row afterwards waits for the hold's transaction and the
-- guard then sees it; one that got there first finishes, and the hold waits
-- for it.
--
-- legal_hold.review_id becomes ON DELETE RESTRICT, so no delete path can
-- take a hold away silently. A released hold is the record of a hold and
-- has always gone with its review; the guard deletes it before the row goes,
-- so purging a review with only released holds works as before.
--
-- Expand-only for the live code: it sets app.retention_run already
-- (0008's audit_log rule), never deletes or redacts a held review on
-- purpose, and deletes reviews only through the paths above.
-- ---------------------------------------------------------------------------

create or replace function review_legal_hold_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from legal_hold h
    where h.organisation_id = old.organisation_id
      and h.review_id = old.id
      and h.released_at is null
  ) and exists (
    select 1 from organisation o where o.id = old.organisation_id
  ) then
    if current_setting('app.retention_run', true) = 'true'
      and pg_trigger_depth() = 1 then
      return null;
    end if;
    raise exception 'review_legal_hold'
      using errcode = '23514', detail = old.id::text;
  end if;
  if tg_op = 'DELETE' then
    delete from legal_hold h
    where h.organisation_id = old.organisation_id
      and h.review_id = old.id;
    return old;
  end if;
  return new;
end;
$$;

revoke all on function review_legal_hold_guard() from public;

create trigger review_legal_hold_delete_guard
  before delete on review
  for each row execute function review_legal_hold_guard();

create trigger review_legal_hold_redaction_guard
  before update of
    review_text,
    reviewer_display_name,
    reviewer_profile_photo_url,
    raw_payload,
    erased_at
  on review
  for each row
  when (
    (old.erased_at is null and new.erased_at is not null)
    or (
      new.raw_payload is null
      and (
        old.raw_payload is not null
        or (old.review_text is not null and new.review_text is null)
        or (
          old.reviewer_display_name is not null
          and new.reviewer_display_name is null
        )
        or (
          old.reviewer_profile_photo_url is not null
          and new.reviewer_profile_photo_url is null
        )
      )
    )
  )
  execute function review_legal_hold_guard();

create or replace function legal_hold_lock_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.released_at is null then
    perform 1
    from review r
    where r.organisation_id = new.organisation_id
      and r.id = new.review_id
    for no key update;
  end if;
  return new;
end;
$$;

revoke all on function legal_hold_lock_review() from public;

create trigger legal_hold_lock_review
  before insert or update of review_id, released_at on legal_hold
  for each row execute function legal_hold_lock_review();

alter table legal_hold
  drop constraint legal_hold_review_id_fkey,
  add constraint legal_hold_review_id_fkey
    foreign key (review_id) references review(id) on delete restrict;

insert into schema_migration (version) values ('0141_legal_hold_enforcement')
on conflict (version) do nothing;

commit;
