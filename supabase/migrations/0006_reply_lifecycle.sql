begin;

alter table publish_attempt
  add column operation text not null default 'publish'
    check (operation in ('publish', 'delete'));

alter table review_reply
  add column publish_generation integer not null default 0,
  add column approval_requested_by uuid references app_user(id) on delete set null,
  add column first_published_at timestamptz;

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

insert into schema_migration (version) values ('0006_reply_lifecycle')
on conflict (version) do nothing;

commit;
