begin;

-- Remove the one historical local-demo provider graph. These exact sentinel
-- values were never issued by Google and must not survive in deployed data.
delete from google_connection
where id = '00000000-0000-4000-8000-000000000010'
   or google_subject = 'local-fixture';

-- Cover partially-created fixture graphs whose synthetic connection is already
-- absent. Cascades remove links, reviews, drafts, replies and sync checkpoints.
delete from external_location
where google_account_name = 'accounts/local'
  and google_location_name = 'locations/local';

delete from google_account
where google_account_name = 'accounts/local';

-- A location is not owned by its Google connection, so remove the orphaned
-- demo location separately without touching a location that gained real data.
delete from location l
where (
    l.id = '00000000-0000-4000-8000-000000000011'
    or l.name = 'Lapen Inns · Local Demo'
  )
  and not exists (
    select 1 from location_link ll where ll.location_id = l.id
  )
  and not exists (
    select 1 from review r where r.location_id = l.id
  );

insert into schema_migration (version)
values ('0004_remove_local_demo_data')
on conflict (version) do nothing;

commit;
