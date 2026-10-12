begin;

-- P08-R4: a schedule is bound to the exact revision of the draft it was
-- made from.
--
-- post_publication_schedule.source_content_revision / source_content_hash
--   The source post's content_revision (0081) and the SHA-256 of what a
--   publish of it sends (the hash post_approval_decision binds), frozen with
--   the template when the schedule is requested or revised. An edit to the
--   source draft re-freezes the schedule from the new content in the same
--   transaction and asks for approval again (status_reason source_changed).
--   A one-time occurrence publishes the source post itself, and only at this
--   revision, instead of creating a second copy of it; a source that was
--   published another way or deleted marks the occurrence superseded.
--   The hash is computed by the application, so a row backfilled here has
--   the revision and no hash; the revision alone binds it (0081 bumps it on
--   every change to a column a publish sends).
--
-- Live rows: a one-time schedule whose template is provably the source's
-- current content gets that revision. One that cannot be proven (the draft
-- changed since, or it is gone or already on Google) goes to an owner's
-- review like 0240/0241: its not-yet-run occurrence is cancelled, a
-- publishing one settles on its own, and nothing is created or sent. A
-- blocked one keeps its reason; it is re-frozen when resubmitted, and the
-- runner re-freezes one that comes back without a revision before it can
-- publish. Safe to run again.

alter table post_publication_schedule
  add column if not exists source_content_revision bigint,
  add column if not exists source_content_hash text;
alter table post_publication_schedule
  drop constraint if exists post_publication_schedule_source_revision_check;
alter table post_publication_schedule
  add constraint post_publication_schedule_source_revision_check
  check (
    (source_content_revision is null or source_content_revision >= 1)
    and (source_content_hash is null or source_content_hash ~ '^[0-9a-f]{64}$')
    and (source_content_hash is null or source_content_revision is not null)
  );

-- The template frozenTemplate() writes: the content columns, nulls left out.
update post_publication_schedule s
set source_content_revision = p.content_revision
from gbp_local_post p
where p.id = s.source_post_id
  and p.organisation_id = s.organisation_id
  and s.source_content_revision is null
  and s.status in ('awaiting_approval', 'active', 'paused', 'blocked', 'needs_review')
  and p.status <> 'deleted'
  and s.template = (
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    from jsonb_each(jsonb_build_object(
      'topicType', p.topic_type,
      'languageCode', p.language_code,
      'summary', p.summary,
      'callToAction', p.call_to_action,
      'event', p.event,
      'offer', p.offer,
      'media', p.media
    )) as e(key, value)
    where e.value <> 'null'::jsonb
  );

-- A one-time schedule publishes its source post, so one whose source is not
-- a publishable draft at a known revision cannot run as approved.
create temporary table post_schedule_source_review on commit drop as
select s.id,
  case
    when p.id is null or p.status in ('deleted', 'publishing', 'published', 'ambiguous')
      or p.google_post_name is not null
      then 'source_superseded'
    else 'source_changed'
  end as reason
from post_publication_schedule s
left join gbp_local_post p on p.id = s.source_post_id
where s.rule ->> 'frequency' = 'once'
  and s.status in ('awaiting_approval', 'active', 'paused')
  and (
    s.source_content_revision is null
    or p.id is null
    or p.status in ('deleted', 'publishing', 'published', 'ambiguous')
    or p.google_post_name is not null
  );

update post_publication_occurrence o
set status = 'cancelled', status_reason = 'schedule_quarantined', finished_at = now()
from post_schedule_source_review r
where o.schedule_id = r.id
  and o.status = 'scheduled';
update post_publication_schedule s
set status = 'needs_review', status_reason = r.reason, updated_at = now()
from post_schedule_source_review r
where s.id = r.id;

-- A one-time schedule's occurrences all publish the same post: one of a
-- revision that missed, was cancelled or was refused must not stop the next
-- revision from claiming it. A post still has at most one occurrence that
-- may be sending it or has sent it.
drop index if exists post_publication_occurrence_post_idx;
create unique index if not exists post_publication_occurrence_live_post_idx
  on post_publication_occurrence (post_id)
  where post_id is not null
    and status in ('scheduled', 'publishing', 'published', 'ambiguous');

insert into schema_migration (version)
values ('0244_post_schedule_source_revision')
on conflict (version) do nothing;

commit;
