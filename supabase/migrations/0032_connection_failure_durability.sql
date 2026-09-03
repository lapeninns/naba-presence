begin;

-- ---------------------------------------------------------------------------
-- Unlink and disconnect only set `location_link.is_active = false`; the row
-- survives. `unique (organisation_id, location_id)` was unconditional, so that
-- dead row kept the internal location's one-to-one slot forever: re-linking it
-- to any other Google location raised 23505, which is neither an ApiError nor a
-- ZodError and so reached the user as a bare 500 with no in-product way out.
--
-- Only ACTIVE links are one-to-one. `unique (organisation_id,
-- external_location_id)` stays unconditional on purpose: both writers
-- (app/api/location-links/route.ts and lib/server/automatic-google-setup.ts)
-- infer their `on conflict` target from it.
-- ---------------------------------------------------------------------------

alter table location_link
  drop constraint if exists location_link_organisation_id_location_id_key;

create unique index if not exists location_link_active_location_idx
  on location_link (organisation_id, location_id)
  where is_active;

insert into schema_migration (version)
values ('0032_connection_failure_durability')
on conflict (version) do nothing;

commit;
