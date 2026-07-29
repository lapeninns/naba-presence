begin;

create table invitation (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null
    references organisation(id) on delete cascade,
  email text not null,
  role text not null
    check (role in ('owner', 'admin', 'member', 'viewer')),
  can_publish boolean not null default false,
  token_hash text not null unique,
  token_ciphertext bytea not null,
  invited_by uuid references app_user(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid,
  created_at timestamptz not null default now()
);

create unique index invitation_pending_unique
  on invitation (organisation_id, email)
  where accepted_at is null;

alter table invitation enable row level security;
alter table invitation force row level security;

create policy invitation_isolation on invitation
  using (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
  );

create function lookup_invitation(p_token_hash text)
returns table (
  organisation_name text,
  email text,
  role text,
  expires_at timestamptz,
  accepted_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    o.name as organisation_name,
    i.email,
    i.role,
    i.expires_at,
    i.accepted_at
  from invitation i
  join organisation o on o.id = i.organisation_id
  where i.token_hash = p_token_hash
  limit 1;
$$;

create function list_user_organisations(p_user_id uuid)
returns table (
  organisation_id uuid,
  name text,
  role text
)
language sql
security definer
set search_path = public
as $$
  select m.organisation_id, o.name, m.role
  from member m
  join organisation o on o.id = m.organisation_id
  where m.user_id = p_user_id
  order by lower(o.name), m.organisation_id;
$$;

create function resolve_invitation_for_acceptance(p_token_hash text)
returns table (
  id uuid,
  organisation_id uuid,
  role text,
  can_publish boolean
)
language sql
security definer
set search_path = public
as $$
  select i.id, i.organisation_id, i.role, i.can_publish
  from invitation i
  where i.token_hash = p_token_hash
  limit 1;
$$;

revoke all on function lookup_invitation(text) from public;
revoke all on function list_user_organisations(uuid) from public;
revoke all on function resolve_invitation_for_acceptance(text) from public;
grant execute on function lookup_invitation(text) to naba_app_runtime;
grant execute on function list_user_organisations(uuid) to naba_app_runtime;
grant execute on function resolve_invitation_for_acceptance(text)
  to naba_app_runtime;

grant select, insert, update, delete on invitation to naba_app_runtime;

insert into schema_migration (version)
values ('0008_product_completeness')
on conflict (version) do nothing;

commit;
