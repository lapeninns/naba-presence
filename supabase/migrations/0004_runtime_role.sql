begin;

-- Grants-holder group role. LOGIN members are created per environment by
-- scripts/db-create-runtime-role.mjs (never by migrations - no passwords here).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'naba_app_runtime') then
    create role naba_app_runtime
      nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit;
  end if;
end
$$;

grant usage on schema public to naba_app_runtime;
grant select, insert, update, delete on all tables in schema public
  to naba_app_runtime;
grant usage, select on all sequences in schema public to naba_app_runtime;

-- The runtime application must never write migration bookkeeping.
revoke insert, update, delete on schema_migration from naba_app_runtime;

insert into schema_migration (version) values ('0004_runtime_role')
on conflict (version) do nothing;

commit;
