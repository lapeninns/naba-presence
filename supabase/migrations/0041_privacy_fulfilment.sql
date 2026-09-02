begin;

-- ---------------------------------------------------------------------------
-- Privacy request fulfilment: a statutory clock, and a transition invariant.
--
-- `due_at` is stored rather than derived as `created_at + interval '30 days'`
-- at read time. The deadline is a property of the request as it was logged:
-- shortening or lengthening the response window later must not retroactively
-- move a deadline already quoted to a data subject, and an Art. 12(3)
-- extension is recorded by moving this one column instead of special-casing
-- every reader. It cannot be a generated column either -- `timestamptz +
-- interval` is stable, not immutable, because month and day arithmetic reads
-- the session TimeZone, so Postgres rejects it in a generation expression.
--
-- `enforce_privacy_request_transition` mirrors
-- `enforce_review_workflow_transition` (0001_initial.sql:444). The status
-- check constraint enumerates the four values but permits any move between
-- them, so a fulfilled erasure could be recorded as rejected by a racing
-- operator, or a rejected request fulfilled later and flipped to completed.
-- The route refuses both with a 409 off a locked read; this trigger is the
-- invariant that survives a future caller which forgets to.
--
-- `pending_review_ids` is the erasure's memory of itself. An erasure parked
-- `in_progress` because Google would not withdraw the reply is retried by
-- fulfilling it again -- but the local scrub has already committed, so the
-- subject reference no longer matches anything: the display-name arm of the
-- match reads `reviewer_display_name`, which is now 'Removed reviewer', and
-- the hash arms only match when the subject was quoted as a Google review id
-- or resource name. Without this column the retry matches zero reviews and
-- completes the request with the reviewer's name still public at Google. It
-- is cleared when the request completes, so a non-empty list on a resolved
-- row is the record of what was still outstanding when it was closed.
-- ---------------------------------------------------------------------------

alter table privacy_request
  add column if not exists due_at timestamptz;

alter table privacy_request
  add column if not exists pending_review_ids uuid[] not null default '{}';

update privacy_request
set due_at = created_at + interval '30 days'
where due_at is null;

alter table privacy_request
  alter column due_at set default now() + interval '30 days';

alter table privacy_request
  alter column due_at set not null;

create or replace function enforce_privacy_request_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status = new.status then
    return new;
  end if;
  if not (
    (old.status = 'pending'
      and new.status in ('in_progress', 'completed', 'rejected'))
    or (old.status = 'in_progress'
      and new.status in ('completed', 'rejected'))
  ) then
    raise exception 'invalid privacy request transition: % -> %',
      old.status, new.status;
  end if;
  return new;
end;
$$;

drop trigger if exists privacy_request_transition on privacy_request;
create trigger privacy_request_transition before update on privacy_request
  for each row execute function enforce_privacy_request_transition();

insert into schema_migration (version)
values ('0041_privacy_fulfilment')
on conflict (version) do nothing;

commit;
