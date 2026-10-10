begin;

-- ---------------------------------------------------------------------------
-- Bind a post approval to the exact content it was asked about.
--
-- Until now an approval of a Google post was a bare "approve" on whatever the
-- row held when the approver's request arrived: an edit between the approver
-- opening the post and pressing Approve published text nobody had approved,
-- the two-person policy was only consulted on the approval route (so a
-- publisher's direct publish, or a PATCH of a live post, skipped it), and
-- nothing recorded which content an approval covered.
--
-- gbp_local_post.content_revision
--   Monotonic per row. The trigger below bumps it whenever a column that is
--   sent to Google changes, so "the content an approver read" has a name the
--   client can send back (expectedRevision) and the server can compare.
--
-- gbp_local_post.approval_requested_revision
--   The revision a request for approval was made against. A content change
--   withdraws the request (requested_by and requested_revision are cleared and
--   an awaiting row drops back to draft): the request was for other text.
--
-- gbp_local_post.content_edited_by
--   The last user who wrote the content locally. Two-person approval needs
--   the approver to be neither the requester nor the author.
--
-- post_approval_decision
--   One row per decision, carrying the revision, the SHA-256 of the provider
--   payload, the requester and the author. A publish only counts an approval
--   whose revision and hash match the row it is about to send. The CHECK
--   makes self-approval unrepresentable rather than merely refused.
--
-- The trigger is deliberately not SECURITY DEFINER (same reasoning as 0039):
-- it only reads and writes NEW.
-- ---------------------------------------------------------------------------

alter table gbp_local_post
  add column content_revision bigint not null default 1
    check (content_revision >= 1),
  add column approval_requested_revision bigint,
  add column content_edited_by uuid references app_user(id) on delete set null;

-- The tenant key post_approval_decision references: a decision row can only
-- name a post of its own organisation, whatever RLS the writer runs under.
alter table gbp_local_post
  add constraint gbp_local_post_organisation_id_id_key
  unique (organisation_id, id);

create or replace function bind_local_post_content_revision()
returns trigger
language plpgsql
as $$
begin
  if (new.topic_type, new.language_code, new.summary, new.call_to_action,
      new.event, new.offer, new.media)
     is distinct from
     (old.topic_type, old.language_code, old.summary, old.call_to_action,
      old.event, old.offer, old.media) then
    new.content_revision := old.content_revision + 1;
    -- A request was for the text it was made against; edited text needs a
    -- new one. Unless this same statement is the request itself (it set the
    -- requested revision explicitly to the new revision), withdraw it.
    if new.approval_requested_revision is not distinct from old.approval_requested_revision then
      new.approval_requested_by := null;
      new.approval_requested_revision := null;
      if new.status = 'awaiting_approval' then
        new.status := 'draft';
      end if;
    end if;
  end if;
  if new.status = 'awaiting_approval' then
    -- Backstop for a writer that parks without naming the revision (rows
    -- seeded directly, an older app instance mid-deploy).
    if new.approval_requested_revision is null then
      new.approval_requested_revision := new.content_revision;
    end if;
  elsif new.status <> 'publishing' then
    -- Rejected, published, failed or back to draft: no request outstanding.
    -- 'publishing' keeps it so the attempt in flight can still be traced to
    -- the request it answers.
    new.approval_requested_revision := null;
  end if;
  return new;
end;
$$;

drop trigger if exists gbp_local_post_content_revision on gbp_local_post;
create trigger gbp_local_post_content_revision
  before update on gbp_local_post
  for each row execute function bind_local_post_content_revision();

create or replace function bind_local_post_requested_revision()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'awaiting_approval' and new.approval_requested_revision is null then
    new.approval_requested_revision := new.content_revision;
  end if;
  return new;
end;
$$;

drop trigger if exists gbp_local_post_requested_revision on gbp_local_post;
create trigger gbp_local_post_requested_revision
  before insert on gbp_local_post
  for each row execute function bind_local_post_requested_revision();

-- Requests parked before this migration were made against the only revision
-- there is.
update gbp_local_post
set approval_requested_revision = content_revision
where status = 'awaiting_approval'
  and approval_requested_revision is null;

create table post_approval_decision (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  post_id uuid not null,
  content_revision bigint not null check (content_revision >= 1),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  requested_by uuid references app_user(id) on delete set null,
  author_id uuid references app_user(id) on delete set null,
  decided_by uuid references app_user(id) on delete set null,
  decision text not null check (decision in ('approved', 'rejected')),
  note text,
  created_at timestamptz not null default now(),
  foreign key (organisation_id, post_id)
    references gbp_local_post (organisation_id, id) on delete cascade,
  check (decided_by <> requested_by)
);

create index post_approval_decision_post_idx
  on post_approval_decision (organisation_id, post_id, content_revision);

alter table post_approval_decision enable row level security;
alter table post_approval_decision force row level security;
create policy tenant_isolation on post_approval_decision
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );

-- Decisions are a record: the runtime role writes and reads them, never
-- rewrites or deletes one (the post's own delete cascades as the owner).
grant select, insert on post_approval_decision to naba_app_runtime;

-- Which approval a publish went out under.
alter table gbp_local_post_attempt
  add column approval_decision_id uuid
    references post_approval_decision(id) on delete set null;

insert into schema_migration (version)
values ('0062_post_approval_binding')
on conflict (version) do nothing;

commit;
