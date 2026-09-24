begin;

-- ---------------------------------------------------------------------------
-- Invitations can be scoped to clients.
--
-- Agencies give people access by client, and a teammate invited "for the Old
-- Crown" used to join seeing every client until someone remembered to narrow
-- them. The invite now records which clients; accepting it inserts one
-- location_member row per listing filed under those clients, in the
-- acceptance transaction (lib/server/provisioning.ts).
--
-- Client ids, not listing ids: the listings are resolved when the invite is
-- ACCEPTED, so a listing filed under the client in the week the link is
-- open is included. 0043's `location_ids` column was never written by the
-- application and is left alone.
--
-- Still no client membership table: after acceptance the scope exists only
-- as location_member rows, read by lib/server/permissions.ts. There is no
-- foreign key per element (Postgres has none for arrays); acceptance joins
-- through `client` under RLS, so an id that is gone or belongs to another
-- organisation simply matches nothing, and an invitation that matches no
-- listing at all is refused rather than accepted unscoped.
-- ---------------------------------------------------------------------------

alter table invitation add column client_ids uuid[];

-- null means "all clients". An empty array would read as a scope that
-- grants nothing, which for a member means every client; say null instead.
-- Owners and admins see every client whatever rows they hold, so a scope on
-- their invitation would be a promise the app does not keep.
alter table invitation
  add constraint invitation_client_ids_scope_check
  check (
    client_ids is null
    or (cardinality(client_ids) > 0 and role in ('member', 'viewer'))
  );

insert into schema_migration (version) values ('0056_invitation_client_scope')
on conflict (version) do nothing;

commit;
