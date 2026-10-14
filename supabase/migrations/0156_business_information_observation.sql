begin;

-- WP-11 (W3-2): the business-information editor is served from its last
-- Google read within the editors' staleness budget, kept as a
-- presence_resource_reconcile_state row like the profile's (0155's
-- observed_google_payload). The sweep never walks this resource; only the
-- editor's reads record it. Additive: the check only gains a value, and
-- every existing row already satisfies it.
alter table presence_resource_reconcile_state
  drop constraint if exists presence_resource_reconcile_state_resource_check;
alter table presence_resource_reconcile_state
  add constraint presence_resource_reconcile_state_resource_check
  check (resource in (
    'hours', 'profile', 'posts', 'media', 'foodMenus', 'placeActions',
    'businessInformation'
  ));

insert into schema_migration (version)
values ('0156_business_information_observation') on conflict (version) do nothing;

commit;
