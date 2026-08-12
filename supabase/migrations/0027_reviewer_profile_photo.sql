begin;

alter table review
  add column reviewer_profile_photo_url text;

-- Prefer an immediate backfill from retained Google payloads so existing
-- inbox rows show photos without waiting for the next reconcile tick.
update review
set reviewer_profile_photo_url = nullif(
  trim(raw_payload->'reviewer'->>'profilePhotoUrl'),
  ''
)
where reviewer_is_anonymous = false
  and raw_payload is not null
  and coalesce(trim(raw_payload->'reviewer'->>'profilePhotoUrl'), '') <> '';

insert into schema_migration (version)
values ('0027_reviewer_profile_photo')
on conflict (version) do nothing;

commit;
