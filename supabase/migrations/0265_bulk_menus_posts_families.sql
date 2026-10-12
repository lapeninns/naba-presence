begin;

-- P09-R6: Food Menus and post drafts in bulk.
--
--   * Batches and children may carry the two new families.
--   * A menus child writes under the menu publisher's key (`food_menus`);
--     its write goes through the editor's own attempt table
--     (food_menus_sync_attempt) and recovery adapter, with a receipt. Its
--     restore point (the canonical revision it saved and the menus it
--     replaced) is kept in bulk_listing_child.hours_restore, the generic
--     restore point the claim already clears.
--   * A post-draft child sends nothing to Google: it inserts one local draft
--     and records its id here in the same transaction, so a re-run claim
--     never drafts twice. Its key (`posts`) only spaces drafts out. A draft
--     deleted later leaves the child pointing at nothing.

alter table bulk_listing_operation
  drop constraint bulk_listing_operation_operation_check,
  add constraint bulk_listing_operation_operation_check check (operation in (
    'regular_hours', 'special_hours', 'more_hours', 'attributes', 'place_action',
    'business_info', 'categories', 'lodging', 'food_menus', 'post_draft', 'mixed'
  ));

alter table bulk_listing_child
  drop constraint bulk_listing_child_resource_key_check,
  add constraint bulk_listing_child_resource_key_check check (resource_key in (
    'hours', 'attributes', 'place_actions', 'business_info', 'lodging',
    'food_menus', 'posts'
  )),
  add column local_post_id uuid,
  -- The draft stays in the child's own organisation (0081's
  -- gbp_local_post_organisation_id_id_key).
  add constraint bulk_listing_child_local_post_fk
    foreign key (organisation_id, local_post_id)
    references gbp_local_post (organisation_id, id)
    on delete set null (local_post_id),
  add constraint bulk_listing_child_local_post_unique unique (local_post_id);

insert into schema_migration(version) values ('0265_bulk_menus_posts_families') on conflict (version) do nothing;
commit;
