begin;

alter table google_onboarding_match_link_review add constraint google_onboarding_match_link_review_target_unique unique (organisation_id, draft_id, id);

-- Local execution records retain one identity per immutable review. Failed
-- transactions may be retried or re-reviewed; active/settled links exclude create.
create table google_onboarding_match_link (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  draft_id uuid not null,
  review_id uuid not null unique,
  review_hash text not null check (length(review_hash) = 64),
  actor_user_id uuid not null references app_user(id) on delete restrict,
  state text not null default 'pending' check (state in ('pending', 'linked', 'failed')),
  attempt_generation integer not null default 1 check (attempt_generation > 0),
  location_id uuid references location(id) on delete set null,
  external_location_id uuid references external_location(id) on delete set null,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organisation_id, draft_id, review_id) references google_onboarding_match_link_review(organisation_id, draft_id, id) on delete cascade
);
create unique index google_onboarding_match_link_active_draft_idx on google_onboarding_match_link (draft_id) where state in ('pending', 'linked');
create index google_onboarding_match_link_draft_idx on google_onboarding_match_link (organisation_id, draft_id, created_at desc, id);
alter table google_onboarding_match_link enable row level security;
alter table google_onboarding_match_link force row level security;
create policy google_onboarding_match_link_isolation on google_onboarding_match_link
  using (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, delete on google_onboarding_match_link to naba_app_runtime;
grant update (state, attempt_generation, location_id, external_location_id, error_code, updated_at) on google_onboarding_match_link to naba_app_runtime;

-- The same parent lock orders both operation families, including direct runtime
-- inserts. A partial unique index alone cannot exclude a row in another table.
create function guard_google_onboarding_operation() returns trigger language plpgsql as $$
begin
  perform 1 from google_onboarding_draft
    where id = new.draft_id and organisation_id = new.organisation_id for update;
  if not found then
    raise exception 'Onboarding target not found' using errcode = '23503';
  end if;
  if tg_table_name = 'google_onboarding_creation' then
    if exists (select 1 from google_onboarding_match_link where draft_id = new.draft_id and state in ('pending', 'linked')) then
      raise exception 'Another onboarding operation owns this draft' using errcode = '23505', constraint = 'onboarding_operation_conflict';
    end if;
  elsif new.state in ('pending', 'linked') and exists (select 1 from google_onboarding_creation where draft_id = new.draft_id) then
    raise exception 'Another onboarding operation owns this draft' using errcode = '23505', constraint = 'onboarding_operation_conflict';
  end if;
  return new;
end;
$$;
create trigger google_onboarding_creation_exclusion before insert on google_onboarding_creation
  for each row execute function guard_google_onboarding_operation();
create trigger google_onboarding_match_link_exclusion before insert or update of state on google_onboarding_match_link
  for each row execute function guard_google_onboarding_operation();

insert into schema_migration (version) values ('0066_google_onboarding_match_link_operations') on conflict (version) do nothing;
commit;
