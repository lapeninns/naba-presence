begin;

-- P09-R5: business information, categories and lodging (the industry
-- family) in bulk.
--
--   * Batches and children may carry the three new families.
--   * Business information and categories patch the location resource under
--     the business-information editor's key (`business_info`); lodging uses
--     the lodging editor's key (`lodging`). The claim's one-running-child per
--     (location, resource_key) rule covers them unchanged.
--   * Their editors run reviewed change sets with no receipts, so their bulk
--     writes record attempts in bulk_listing_write_attempt, which the
--     recovery registry reads back (lib/server/bulk-families/write-attempts.ts).
--   * Healthcare is not a bulk family (pending decision D-24).

alter table bulk_listing_operation
  drop constraint bulk_listing_operation_operation_check,
  add constraint bulk_listing_operation_operation_check check (operation in (
    'regular_hours', 'special_hours', 'more_hours', 'attributes', 'place_action',
    'business_info', 'categories', 'lodging', 'mixed'
  ));

alter table bulk_listing_child
  drop constraint bulk_listing_child_resource_key_check,
  add constraint bulk_listing_child_resource_key_check check (resource_key in (
    'hours', 'attributes', 'place_actions', 'business_info', 'lodging'
  ));

alter table bulk_listing_write_attempt
  drop constraint bulk_listing_write_attempt_family_check,
  add constraint bulk_listing_write_attempt_family_check check (family in (
    'attributes', 'place_action', 'business_info', 'categories', 'lodging'
  ));

insert into schema_migration(version) values ('0127_bulk_business_info_families') on conflict (version) do nothing;
commit;
