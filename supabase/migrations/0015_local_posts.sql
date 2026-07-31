begin;

create table gbp_local_post (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  external_location_id uuid not null references external_location(id) on delete cascade,
  topic_type text not null check (topic_type in ('STANDARD', 'EVENT', 'OFFER')),
  language_code text not null default 'en-GB',
  summary text not null default '',
  call_to_action jsonb,
  event jsonb,
  offer jsonb,
  media jsonb not null default '[]'::jsonb,
  scheduled_publish_time timestamptz,
  recurrence jsonb,
  status text not null default 'draft' check (
    status in (
      'draft', 'awaiting_approval', 'publishing', 'published',
      'failed', 'ambiguous', 'deleted'
    )
  ),
  google_post_name text,
  google_state text,
  google_search_url text,
  provider_payload jsonb,
  provider_payload_expires_at timestamptz,
  provider_create_time timestamptz,
  provider_update_time timestamptz,
  last_error_code text,
  approval_requested_by uuid references app_user(id) on delete set null,
  approved_by uuid references app_user(id) on delete set null,
  created_by uuid references app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, google_post_name)
);

create table gbp_local_post_attempt (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  post_id uuid not null references gbp_local_post(id) on delete cascade,
  actor_user_id uuid references app_user(id) on delete set null,
  operation text not null check (operation in ('create', 'update', 'delete')),
  status text not null check (
    status in ('started', 'succeeded', 'failed', 'ambiguous')
  ),
  idempotency_key text not null,
  intended_payload jsonb not null,
  provider_http_status integer,
  provider_error_code text,
  provider_response jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organisation_id, idempotency_key)
);

create index gbp_local_post_location_idx
  on gbp_local_post (organisation_id, location_id, updated_at desc)
  where status <> 'deleted';
create index gbp_local_post_attempt_idx
  on gbp_local_post_attempt (organisation_id, post_id, created_at desc);

create trigger gbp_local_post_updated_at
  before update on gbp_local_post
  for each row execute function set_updated_at();

alter table gbp_local_post enable row level security;
alter table gbp_local_post force row level security;
create policy gbp_local_post_isolation on gbp_local_post
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );

alter table gbp_local_post_attempt enable row level security;
alter table gbp_local_post_attempt force row level security;
create policy gbp_local_post_attempt_isolation on gbp_local_post_attempt
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );

grant select, insert, update, delete on gbp_local_post to naba_app_runtime;
grant select, insert, update, delete on gbp_local_post_attempt to naba_app_runtime;

insert into schema_migration (version)
values ('0015_local_posts')
on conflict (version) do nothing;

commit;
