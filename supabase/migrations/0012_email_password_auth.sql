begin;

alter table app_user
  add column auth_provider text,
  add column auth_subject text,
  add column email_verified_at timestamptz;

alter table app_user
  add constraint app_user_auth_identity_pair_check
  check (
    (auth_provider is null and auth_subject is null)
    or
    (auth_provider is not null and auth_subject is not null)
  );

create unique index app_user_auth_identity_unique
  on app_user (auth_provider, auth_subject)
  where auth_provider is not null and auth_subject is not null;

create function provision_authenticated_user(
  p_provider text,
  p_subject text,
  p_email text,
  p_display_name text,
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
  v_email text := lower(trim(p_email));
  v_user app_user%rowtype;
  v_email_change_held boolean := false;
begin
  if p_email_verified is not true then
    raise exception 'unverified_auth_email';
  end if;
  if trim(p_provider) = '' or trim(p_subject) = '' or v_email = '' then
    raise exception 'invalid_auth_identity';
  end if;

  select u.*
  into v_user
  from app_user u
  where u.auth_provider = p_provider
    and u.auth_subject = p_subject
  limit 1;

  if found then
    if lower(v_user.email) is distinct from v_email then
      if exists (
        select 1
        from app_user other
        where lower(other.email) = v_email
          and other.id <> v_user.id
      ) then
        v_email_change_held := true;
      else
        update app_user
        set email = v_email
        where app_user.id = v_user.id;
      end if;
    end if;
    update app_user
    set
      display_name = p_display_name,
      email_verified_at = coalesce(email_verified_at, now()),
      updated_at = now()
    where app_user.id = v_user.id
    returning * into v_user;
  else
    select u.*
    into v_user
    from app_user u
    where lower(u.email) = v_email
    limit 1;

    if found then
      if v_user.auth_subject is not null
        and (
          v_user.auth_provider is distinct from p_provider
          or v_user.auth_subject is distinct from p_subject
        ) then
        raise exception 'auth_identity_conflict';
      end if;
      update app_user
      set
        auth_provider = p_provider,
        auth_subject = p_subject,
        display_name = p_display_name,
        email_verified_at = coalesce(email_verified_at, now()),
        updated_at = now()
      where app_user.id = v_user.id
      returning * into v_user;
    else
      insert into app_user (
        email,
        display_name,
        auth_provider,
        auth_subject,
        email_verified_at
      )
      values (
        v_email,
        p_display_name,
        p_provider,
        p_subject,
        now()
      )
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

revoke all on function provision_authenticated_user(
  text,
  text,
  text,
  text,
  boolean
) from public;
grant execute on function provision_authenticated_user(
  text,
  text,
  text,
  text,
  boolean
) to naba_app_runtime;

insert into schema_migration (version)
values ('0012_email_password_auth')
on conflict (version) do nothing;

commit;
