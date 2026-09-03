begin;

-- ---------------------------------------------------------------------------
-- Clients: the grouping an agency actually works in.
--
-- Until now `location` sat directly under `organisation`, which fits one
-- business with one listing and nothing else. An agency managing many client
-- businesses had no way to say which locations belong to whom: the inbox,
-- the reports and the connection health were all organisation-wide, and
-- "which client's Google broke" was unanswerable.
--
-- `client` is that missing level. It lives INSIDE the organisation, so tenant
-- isolation is unchanged -- every query still runs under one
-- app.organisation_id and RLS keeps doing its job. No cross-organisation view
-- is introduced here and none is planned.
--
-- Visibility deliberately gets NO new table. lib/server/permissions.ts is the
-- single rule for who sees what, and a `client_member` table would make it
-- two rules that can disagree. A client is visible when one of its locations
-- is; see clientVisibilityPredicate.
-- ---------------------------------------------------------------------------

create table client (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  name text not null,
  slug text not null,
  logo_url text,
  -- Hex only: the value is rendered into an avatar chip, and accepting
  -- arbitrary CSS colour syntax there is an injection surface.
  colour text check (colour ~ '^#[0-9a-fA-F]{6}$'),
  notes text,
  archived_at timestamptz,
  created_by uuid references app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, slug),
  unique (organisation_id, name)
);

create trigger client_updated_at
  before update on client
  for each row execute function set_updated_at();

alter table client enable row level security;
alter table client force row level security;
create policy tenant_isolation on client
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );

grant select, insert, update, delete on client to naba_app_runtime;

-- Nullable on purpose. A location discovered from Google before anyone has
-- decided which client owns it is a real state, and the UI shows those under
-- "Unassigned locations" rather than inventing a placeholder client row.
alter table location add column client_id uuid references client(id) on delete set null;
create index location_client_idx on location (organisation_id, client_id);

-- Home shows a setup checklist until the first client is fully connected.
-- Dismissal is the one piece of setup state worth storing; every other step
-- is derived from what exists (see GET /api/clients/[id]/setup).
alter table organisation add column setup_checklist_dismissed_at timestamptz;

-- An invitation can now be scoped to a client's locations, applied as
-- location_member rows when the invite is accepted.
alter table invitation add column location_ids uuid[];

-- ---------------------------------------------------------------------------
-- Backfill: one client per Google account that has linked locations.
--
-- google_account.google_account_name is Google's own account grouping, which
-- for an agency is very close to "the client". It is the only signal in the
-- data, so it seeds the clients; anything unlinked stays unassigned.
--
-- Runs as the migration role, outside any tenant transaction, so it spans
-- every organisation at once (RLS is FORCE-d for naba_app_runtime, not for
-- the owner running migrations).
-- ---------------------------------------------------------------------------
do $$
declare
  account record;
  base_slug text;
  candidate_slug text;
  suffix integer;
  new_client_id uuid;
begin
  for account in
    select distinct
      ga.organisation_id,
      ga.google_account_name,
      coalesce(nullif(ga.account_name, ''), ga.google_account_name) as display_name
    from google_account ga
    where exists (
      select 1
      from external_location e
      join location_link ll
        on ll.external_location_id = e.id
       and ll.is_active
      where e.organisation_id = ga.organisation_id
        and e.google_account_name = ga.google_account_name
    )
    order by ga.organisation_id, ga.google_account_name
  loop
    base_slug := nullif(
      regexp_replace(lower(account.display_name), '[^a-z0-9]+', '-', 'g'),
      ''
    );
    base_slug := trim(both '-' from coalesce(base_slug, 'client'));
    if base_slug = '' then
      base_slug := 'client';
    end if;

    -- Two Google accounts can share a display name; the unique constraints
    -- are on (organisation_id, slug) and (organisation_id, name), so both
    -- get a suffix rather than one of them failing the migration.
    candidate_slug := base_slug;
    suffix := 1;
    while exists (
      select 1 from client
      where organisation_id = account.organisation_id
        and (slug = candidate_slug or name = account.display_name || case when suffix = 1 then '' else ' ' || suffix end)
    ) loop
      suffix := suffix + 1;
      candidate_slug := base_slug || '-' || suffix;
    end loop;

    insert into client (organisation_id, name, slug)
    values (
      account.organisation_id,
      account.display_name || case when suffix = 1 then '' else ' ' || suffix end,
      candidate_slug
    )
    returning id into new_client_id;

    update location l
       set client_id = new_client_id
      from location_link ll
      join external_location e on e.id = ll.external_location_id
     where ll.location_id = l.id
       and ll.is_active
       and l.organisation_id = account.organisation_id
       and e.google_account_name = account.google_account_name
       and l.client_id is null;
  end loop;
end;
$$;

insert into schema_migration (version) values ('0043_clients')
on conflict (version) do nothing;

commit;
