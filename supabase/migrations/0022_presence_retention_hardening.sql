begin;

alter table gbp_local_post_attempt
  add column expires_at timestamptz not null default now() + interval '180 days';
create index gbp_local_post_attempt_expiry_idx
  on gbp_local_post_attempt (organisation_id, expires_at);

alter table gbp_media_item
  add column payload_expires_at timestamptz not null default now() + interval '30 days';
create index gbp_media_item_payload_expiry_idx
  on gbp_media_item (organisation_id, payload_expires_at);

insert into schema_migration (version)
values ('0022_presence_retention_hardening')
on conflict (version) do nothing;

commit;
