begin;

drop table if exists public_menu_route;
drop table if exists menu;
drop function if exists sync_public_menu_route();

insert into schema_migration (version) values ('0003_remove_menu_assistant')
on conflict (version) do nothing;

commit;
