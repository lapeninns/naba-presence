begin;

-- ops_pause_event is the operator pause history (0090). Its row trigger
-- refuses UPDATE and DELETE, but a row trigger never fires on TRUNCATE, so
-- the owner connection could still erase the history in one statement. A
-- statement-level trigger closes that; the function is 0090's own.
create trigger ops_pause_event_no_truncate
  before truncate on ops_pause_event
  for each statement execute function ops_pause_event_append_only();

insert into schema_migration (version) values ('0091_ops_pause_event_no_truncate')
on conflict (version) do nothing;

commit;
