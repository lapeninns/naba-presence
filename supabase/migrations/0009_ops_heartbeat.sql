begin;

create table ops_heartbeat (
  name text primary key,
  beat_at timestamptz not null
);

grant select, insert, update on ops_heartbeat to naba_app_runtime;

insert into schema_migration (version)
values ('0009_ops_heartbeat')
on conflict (version) do nothing;

commit;
