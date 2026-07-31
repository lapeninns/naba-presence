begin;

delete from presence_resource_reconcile_state where resource = 'qa';

alter table presence_resource_reconcile_state
  drop constraint if exists presence_resource_reconcile_state_resource_check;
alter table presence_resource_reconcile_state
  add constraint presence_resource_reconcile_state_resource_check
  check (resource in ('hours', 'profile', 'posts', 'media', 'foodMenus', 'placeActions'));

drop table if exists qa_answer_attempt;
drop table if exists qa_answer_draft;
drop table if exists gbp_question;

insert into schema_migration (version)
values ('0025_remove_unsupported_qa')
on conflict (version) do nothing;

commit;
