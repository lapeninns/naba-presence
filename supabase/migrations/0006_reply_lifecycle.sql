begin;

alter table publish_attempt
  add column operation text not null default 'publish'
    check (operation in ('publish', 'delete')),
  add column intended_body text;

alter table review_reply
  add column publish_generation integer not null default 0,
  add column approval_requested_by uuid references app_user(id) on delete set null,
  add column first_published_at timestamptz;

alter table draft
  add column tone text,
  add column language text,
  add column business_context text,
  add column draft_policy_version text;

alter table organisation
  add column require_two_person_approval boolean not null default false;

create table approval_decision (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  review_id uuid not null references review(id) on delete cascade,
  draft_id uuid references draft(id) on delete set null,
  decided_by uuid references app_user(id) on delete set null,
  decision text not null check (decision in ('approved', 'rejected')),
  note text,
  created_at timestamptz not null default now()
);
alter table approval_decision enable row level security;
alter table approval_decision force row level security;
create policy tenant_isolation on approval_decision using (
  organisation_id =
    nullif(current_setting('app.organisation_id', true), '')::uuid
) with check (
  organisation_id =
    nullif(current_setting('app.organisation_id', true), '')::uuid
);
grant select, insert, update, delete on approval_decision
  to naba_app_runtime;

create or replace function enforce_review_workflow_transition()
returns trigger
language plpgsql
as $$
begin
  if old.workflow_status = new.workflow_status then
    return new;
  end if;
  if current_setting('app.provider_reconciliation', true) = 'true'
    and new.workflow_status in ('new', 'published', 'rejected') then
    return new;
  end if;
  if not (
    (old.workflow_status = 'new' and new.workflow_status in ('drafted', 'escalated', 'published'))
    or (old.workflow_status = 'drafted' and new.workflow_status in ('verified', 'drafted', 'escalated'))
    or (old.workflow_status = 'verified' and new.workflow_status in ('drafted', 'awaiting_approval', 'publish_requested', 'escalated'))
    or (old.workflow_status = 'awaiting_approval' and new.workflow_status in ('drafted', 'publish_requested', 'escalated'))
    or (old.workflow_status = 'publish_requested' and new.workflow_status in ('published', 'rejected', 'failed'))
    or (old.workflow_status = 'published' and new.workflow_status in ('drafted', 'new', 'rejected'))
    or (old.workflow_status = 'rejected' and new.workflow_status in ('drafted', 'publish_requested', 'new'))
    or (old.workflow_status = 'failed' and new.workflow_status in ('drafted', 'publish_requested', 'new'))
    or (old.workflow_status = 'escalated' and new.workflow_status in ('drafted', 'awaiting_approval', 'publish_requested'))
  ) then
    raise exception 'invalid review workflow transition: % -> %',
      old.workflow_status, new.workflow_status;
  end if;
  return new;
end;
$$;

insert into schema_migration (version) values ('0006_reply_lifecycle')
on conflict (version) do nothing;

commit;
