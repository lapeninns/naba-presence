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

update review_reply rr
set first_published_at = coalesce(
  (
    select min(pa.finished_at)
    from publish_attempt pa
    where pa.review_reply_id = rr.id
      and pa.operation = 'publish'
      and pa.status = 'succeeded'
  ),
  case
    when rr.publish_status in ('published', 'accepted', 'rejected')
      then rr.google_reply_updated_at
  end
)
where rr.first_published_at is null;

alter table external_location
  add column google_average_rating numeric(3, 2),
  add column google_total_review_count integer,
  add column provider_totals_refreshed_at timestamptz;

grant select (
  google_average_rating,
  google_total_review_count,
  provider_totals_refreshed_at
) on external_location to naba_app_runtime;
grant update (
  google_average_rating,
  google_total_review_count,
  provider_totals_refreshed_at
) on external_location to naba_app_runtime;

drop index if exists review_search_idx;
create index review_search_idx on review using gin (
  to_tsvector(
    'simple',
    coalesce(review_text, '') || ' ' ||
    coalesce(reviewer_display_name, '')
  )
);
create index review_google_id_hash_idx
  on review (organisation_id, google_review_id_hash);

alter table organisation
  add column audit_retention_days integer not null default 365
    check (audit_retention_days between 30 and 3650);

alter table review
  add column restricted_at timestamptz;

alter table review
  drop constraint review_star_rating_check,
  alter column star_rating drop not null,
  add constraint review_star_rating_check
    check (star_rating is null or star_rating between 1 and 5);

drop function provision_google_user(text, text, text);

create or replace function provision_google_user(
  p_email text,
  p_display_name text,
  p_google_subject text,
  p_email_verified boolean
) returns table (
  id uuid,
  default_organisation_id uuid,
  email_change_held boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user app_user%rowtype;
  v_email_change_held boolean := false;
begin
  select u.*
  into v_user
  from app_user u
  where u.google_subject = p_google_subject
  limit 1;

  if found then
    if p_email_verified
      and v_user.email is distinct from p_email then
      if exists (
        select 1
        from app_user u
        where u.email = p_email
          and u.id <> v_user.id
      ) then
        v_email_change_held := true;
      else
        update app_user
        set email = p_email
        where app_user.id = v_user.id;
      end if;
    end if;
    update app_user
    set display_name = p_display_name
    where app_user.id = v_user.id
    returning * into v_user;
  else
    select u.*
    into v_user
    from app_user u
    where u.email = p_email
    limit 1;

    if found then
      if p_email_verified is not true then
        raise exception 'unverified_email_conflict';
      end if;
      update app_user
      set
        google_subject = p_google_subject,
        display_name = p_display_name
      where app_user.id = v_user.id
      returning * into v_user;
    else
      insert into app_user (email, display_name, google_subject)
      values (p_email, p_display_name, p_google_subject)
      returning * into v_user;
    end if;
  end if;

  return query
  select
    v_user.id,
    v_user.default_organisation_id,
    v_email_change_held;
end;
$$;

revoke all on function provision_google_user(text, text, text, boolean)
  from public;
grant execute on function provision_google_user(text, text, text, boolean)
  to naba_app_runtime;

create or replace function reject_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE'
    and current_setting('app.retention_run', true) = 'true' then
    return old;
  end if;
  raise exception 'audit_log is append-only';
end;
$$;

insert into schema_migration (version)
values ('0008_product_completeness')
on conflict (version) do nothing;

commit;
