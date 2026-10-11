begin;

-- P08-R2: one-time publication slots are strict. A slot's UTC offset is
-- stored on the schedule (it is what an approver approved when a local time
-- happens twice), and each occurrence carries the deadline after which it
-- may no longer start: intended + 5 minutes.
--
-- 0079 may already be applied with live rows, so every step works on
-- existing data and the whole file is safe to run again.

alter table post_publication_schedule add column if not exists offset_minutes integer;
alter table post_publication_schedule drop constraint if exists post_publication_schedule_offset_minutes_check;
alter table post_publication_schedule add constraint post_publication_schedule_offset_minutes_check
  check (offset_minutes is null or offset_minutes between -840 and 840);

-- A one-time schedule's offset, where the run it was approved for shows it
-- unambiguously: the current revision's occurrence, unadjusted by a clock
-- change. Anything else stays null; approving it resolves the slot strictly
-- and stores the offset, so an ambiguous or nonexistent time then needs a new
-- revision. The stored payload hash stays valid: an unadjusted run's time
-- happens once, and the hash covers an offset only for a time that happens
-- twice (schedulePayloadHash).
update post_publication_schedule s
set offset_minutes = (
  extract(epoch from ((o.local_date + o.local_time::time) - (o.intended_at at time zone 'UTC'))) / 60
)::integer
from post_publication_occurrence o
where o.schedule_id = s.id
  and o.schedule_revision = s.revision
  and o.adjustment = 'none'
  and s.rule ->> 'frequency' = 'once'
  and s.offset_minutes is null;

-- A live (active or paused) one-time schedule left without an offset was
-- approved for a run the lenient rules moved across a clock change (or has
-- no run at all). Strict slots never move a time, so it goes to an owner's
-- review, as 0240 did for repeating schedules: its not-yet-run occurrence is
-- cancelled (one already publishing settles on its own) and a new revision
-- with a valid time, or a cancellation, follows. A waiting one is approved
-- strictly; a blocked one keeps its unresolved-run reason and is resubmitted
-- strictly.
update post_publication_occurrence o
set status = 'cancelled', status_reason = 'schedule_quarantined', finished_at = now()
from post_publication_schedule s
where o.schedule_id = s.id
  and o.status = 'scheduled'
  and s.rule ->> 'frequency' = 'once'
  and s.offset_minutes is null
  and s.status in ('active', 'paused');

update post_publication_schedule
set status = 'needs_review', status_reason = 'slot_needs_new_time', updated_at = now()
where rule ->> 'frequency' = 'once'
  and offset_minutes is null
  and status in ('active', 'paused');

alter table post_publication_occurrence add column if not exists deadline_at timestamptz;

-- Rows written by code that does not know the column yet (a deploy in
-- progress) still get their deadline, and moving an occurrence's intended
-- instant without naming a deadline moves the deadline with it.
create or replace function post_publication_occurrence_default_deadline()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.deadline_at is null then
      new.deadline_at := new.intended_at + interval '5 minutes';
    end if;
  elsif new.intended_at is distinct from old.intended_at
    and new.deadline_at is not distinct from old.deadline_at then
    new.deadline_at := new.intended_at + interval '5 minutes';
  end if;
  return new;
end $$;
drop trigger if exists post_publication_occurrence_default_deadline on post_publication_occurrence;
create trigger post_publication_occurrence_default_deadline
  before insert or update of intended_at on post_publication_occurrence
  for each row execute function post_publication_occurrence_default_deadline();

update post_publication_occurrence set deadline_at = intended_at + interval '5 minutes' where deadline_at is null;
alter table post_publication_occurrence alter column deadline_at set not null;
alter table post_publication_occurrence drop constraint if exists post_publication_occurrence_deadline_check;
alter table post_publication_occurrence add constraint post_publication_occurrence_deadline_check
  check (deadline_at > intended_at);

insert into schema_migration(version) values ('0241_post_schedule_strict_slot') on conflict (version) do nothing;
commit;
