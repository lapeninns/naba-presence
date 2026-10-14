begin;

-- WP-11 (W3-2, W0-04): the Google payload behind a resource's latest
-- successful observation. An editor opened within its staleness budget is
-- served from it (and the canonical row) instead of re-reading Google on
-- every open. Nullable and additive: a row without one, or whose payload no
-- longer hashes to observed_google_hash (a publish readback, an older
-- writer), is simply read live again. Existing forced tenant RLS and the
-- organisation/location/resource unique index cover the new column.
alter table presence_resource_reconcile_state
  add column observed_google_payload jsonb;

insert into schema_migration (version)
values ('0155_editor_observed_payload') on conflict (version) do nothing;

commit;
