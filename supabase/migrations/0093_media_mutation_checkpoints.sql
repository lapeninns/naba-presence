begin;

-- ---------------------------------------------------------------------------
-- Media upload checkpoints and create reconciliation (plan P03-S5).
--
-- A photo upload is three provider calls: start an upload (Google reserves a
-- dataRef), send the bytes to it, then create the media item from it. Only
-- the last can put anything on the listing, so the attempt now records how
-- far it got before each call goes out (lib/server/media.ts):
--
--   upload_phase     none -> data_ref_obtained -> bytes_uploaded ->
--                    create_sent. Anything that goes wrong before
--                    create_sent is a plain failure, safe to retry; only a
--                    create that was sent can be uncertain.
--   upload_data_ref  the reference Google reserved for the bytes.
--   content_sha256   what was created (the bytes, or the source URL); with
--                    the intent it keys the create, and an unresolved
--                    create blocks another create of the same content.
--   started_at       when the attempt was (re-)armed. Recovery and the
--                    retention reaper date in-flight rows by it instead of
--                    created_at, and reconciliation only matches media
--                    Google created after it.
--
-- An uncertain create is matched against the live media list. When no single
-- item matches, the attempt is 'needs_resolution': a person checks Google and
-- records `resolution` ('adopted': it is there; 'abandoned': it is not). It is
-- never created again blindly.
--
-- Expand-only. The new columns are nullable or carry constant defaults, so
-- existing rows read as phase 'none' started when this ran; the status CHECK
-- only widens. The existing forced tenant RLS and table-level runtime grants
-- (0019) cover the new columns.
-- ---------------------------------------------------------------------------

alter table gbp_media_mutation
  add column started_at timestamptz not null default now(),
  add column upload_phase text not null default 'none'
    check (upload_phase in ('none', 'data_ref_obtained', 'bytes_uploaded', 'create_sent')),
  add column upload_data_ref text,
  add column content_sha256 text,
  add column resolution text
    check (resolution is null or resolution in ('adopted', 'abandoned')),
  add column resolved_by_user_id uuid references app_user(id) on delete set null,
  add column resolved_at timestamptz;

alter table gbp_media_mutation
  drop constraint if exists gbp_media_mutation_status_check;
alter table gbp_media_mutation
  add constraint gbp_media_mutation_status_check check (
    status in ('started', 'succeeded', 'failed', 'ambiguous', 'needs_resolution')
  );

-- The unresolved-create lookup: one location's creates of one content.
create index gbp_media_mutation_content_idx
  on gbp_media_mutation (organisation_id, location_id, content_sha256)
  where operation = 'create' and content_sha256 is not null;

insert into schema_migration (version) values ('0093_media_mutation_checkpoints')
on conflict (version) do nothing;

commit;
