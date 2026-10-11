begin;

-- ---------------------------------------------------------------------------
-- Owner-driven workspace mode changes (plan P06-5).
--
-- PATCH /api/organisations { workspaceMode } switches an organisation between
-- business and agency mode (lib/server/workspace-mode.ts). Agency to business
-- is allowed only while the organisation has at most one active client, and
-- that count is only meaningful if no second active client can appear while
-- the switch is deciding. The route pre-check in POST /api/clients reads the
-- mode without a lock, so a client created concurrently with a switch could
-- leave a business organisation with two active clients.
--
-- This trigger closes that race at the database. Any active, non-home client
-- row (a create, a restore from archive, or a demotion from home) takes a
-- FOR SHARE lock on its organisation row and refuses when the organisation is
-- in business mode. The mode change holds FOR UPDATE on the same row, so the
-- two serialise: whichever commits second sees the other's result.
--
-- Rows that leave the client inactive (archiving) or keep it home take no
-- lock. Writers outside the route handlers (support tooling, scripts) get the
-- same guard as 0061's home-client triggers.
-- ---------------------------------------------------------------------------
create function client_guard_business_single() returns trigger
language plpgsql as $$
declare
  mode text;
begin
  if new.is_home or new.archived_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and not old.is_home
     and old.archived_at is null then
    -- Already an active non-home client; nothing about the count changes.
    return new;
  end if;
  select workspace_mode into mode
  from organisation
  where id = new.organisation_id
  for share;
  if mode = 'business' then
    raise exception 'a business organisation has only its home client'
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger client_guard_business_single
  before insert or update of archived_at, is_home on client
  for each row execute function client_guard_business_single();

insert into schema_migration (version)
values ('0102_workspace_mode_change') on conflict (version) do nothing;
commit;
