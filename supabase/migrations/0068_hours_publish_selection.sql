begin;

-- ---------------------------------------------------------------------------
-- Selective hours publication (P09-S1).
--
-- hours_sync_attempt.selection
--   The parts of the saved schedule an attempt published: weekdays, special
--   start dates and more-hours service types. Null is the whole-schedule
--   publish every attempt made before this column existed. intended_payload
--   stays the exact Google payload (selected parts merged over live Google).
--
-- presence_resource_reconcile_state.observed_google_part_hashes
--   Google's per-part hashes at the latest successful observation, so the
--   listing summary can classify drift per part without reading Google.
--
-- presence_resource_reconcile_state.comparison_part_hashes
--   The per-part comparison baseline: {complete, parts: {key: [canonical,
--   google]}}. A selective publish moves the baseline of the parts it wrote
--   and keeps the rest, so the unselected differences it leaves on purpose
--   stay local changes instead of reading as Google changes or conflicts.
--
-- Additive, nullable columns only. Existing forced tenant RLS and the
-- table-level runtime grants cover them. No backfill: a missing part
-- baseline falls back to the whole-schedule comparison.
-- ---------------------------------------------------------------------------

alter table hours_sync_attempt
  add column selection jsonb
    check (selection is null or jsonb_typeof(selection) = 'object');

alter table presence_resource_reconcile_state
  add column observed_google_part_hashes jsonb
    check (
      observed_google_part_hashes is null
      or jsonb_typeof(observed_google_part_hashes) = 'object'
    ),
  add column comparison_part_hashes jsonb
    check (
      comparison_part_hashes is null
      or jsonb_typeof(comparison_part_hashes) = 'object'
    );

insert into schema_migration (version) values ('0068_hours_publish_selection')
on conflict (version) do nothing;

commit;
