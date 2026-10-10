begin;

-- ---------------------------------------------------------------------------
-- Operator pause controls and per-organisation feature flags (ledger OPS-06).
--
-- Until now every kill switch was an environment flag, read once per process
-- (lib/server/env.ts getServerEnv), so stopping provider traffic took an
-- environment change and a redeploy. ops_pause_control is the hot switch:
-- one row per pause scope, read by lib/server/pause-controls.ts through a
-- short cache at the runner's claim (lib/server/jobs.ts claimableKinds) and
-- at provider dispatch (lib/server/gbp-write.ts runGbpWrite, the reply
-- pipeline). The environment flags stay as hard overrides: an env flag that
-- is off pauses its scope whatever this table says, and a row here can only
-- add a pause, never lift one.
--
-- Scopes are the env switches' own names plus the work that has no switch
-- yet: scheduled_post (P08), bulk (P09), billing (P07), mutation_recover
-- (P03-S6) and invitation_email (P06-6) reserve their rows now so the
-- slices that add that work check a scope that already exists.
--
-- Platform-level like ops_heartbeat: no tenant data, read outside withTenant.
-- The runtime role reads both tables and writes neither: a pause is set or
-- lifted only through set_ops_pause, which naba_app_runtime cannot execute,
-- from the operator connection (scripts/ops-pause.mjs, docs/runbook.md
-- "Kill switches"). A compromised request path can therefore see that a
-- scope is paused but cannot lift the pause.
--
-- ops_pause_event is the append-only history: every set_ops_pause call
-- writes one row, including a call that leaves the state unchanged, so the
-- record says who confirmed a pause as well as who flipped it.
--
-- organisation_feature is the per-organisation product flag (P08 post
-- scheduling, P09 bulk actions, ...): a feature an organisation has no row
-- for is off. Tenant data, so RLS is forced with the 0015 isolation policy;
-- the runtime reads it inside withTenant (lib/server/org-features.ts
-- isOrgFeatureEnabled) and operators write it from the owner connection.
-- ---------------------------------------------------------------------------

create table ops_pause_control (
  scope text primary key check (
    scope in (
      'jobs',
      'publish',
      'sync',
      'notifications',
      'retention',
      'drafts',
      'profileWrites',
      'posts',
      'media',
      'placeActions',
      'foodMenus',
      'performance',
      'keywords',
      'scheduled_post',
      'bulk',
      'billing',
      'mutation_recover',
      'invitation_email'
    )
  ),
  paused boolean not null default false,
  reason text check (reason is null or length(reason) between 1 and 500),
  changed_by text
    check (changed_by is null or length(changed_by) between 1 and 200),
  changed_at timestamptz not null default now(),
  -- A pause must say why and who, so on-call reading the table later is not
  -- left guessing whether it is deliberate.
  check (not paused or (reason is not null and changed_by is not null))
);

insert into ops_pause_control (scope)
values
  ('jobs'),
  ('publish'),
  ('sync'),
  ('notifications'),
  ('retention'),
  ('drafts'),
  ('profileWrites'),
  ('posts'),
  ('media'),
  ('placeActions'),
  ('foodMenus'),
  ('performance'),
  ('keywords'),
  ('scheduled_post'),
  ('bulk'),
  ('billing'),
  ('mutation_recover'),
  ('invitation_email')
on conflict (scope) do nothing;

create table ops_pause_event (
  id bigint generated always as identity primary key,
  scope text not null references ops_pause_control (scope),
  paused boolean not null,
  -- The state before this call, so a no-op confirmation is distinguishable
  -- from a flip.
  previously_paused boolean not null,
  reason text not null check (length(reason) between 1 and 500),
  changed_by text not null check (length(changed_by) between 1 and 200),
  changed_at timestamptz not null default now()
);

create index ops_pause_event_scope_changed_at_idx
  on ops_pause_event (scope, changed_at desc);

create function ops_pause_event_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ops_pause_event is append-only';
end;
$$;

create trigger ops_pause_event_no_update
  before update or delete on ops_pause_event
  for each row execute function ops_pause_event_append_only();

alter table ops_pause_control enable row level security;
alter table ops_pause_event enable row level security;
-- Every role that may read sees every row: the tables are platform-level
-- and hold no tenant data. Writes have no policy, so only the owner (and
-- set_ops_pause, which runs as the caller) can make them.
create policy ops_pause_control_read on ops_pause_control for select using (true);
create policy ops_pause_event_read on ops_pause_event for select using (true);

revoke all on ops_pause_control from public;
revoke all on ops_pause_event from public;
grant select on ops_pause_control to naba_app_runtime;
grant select on ops_pause_event to naba_app_runtime;

-- Sets or lifts one scope's pause and records the call. Runs as the caller
-- (not SECURITY DEFINER), so only a role that can already write the tables
-- -- the owner/operator connection -- can use it.
create function set_ops_pause(
  p_scope text,
  p_paused boolean,
  p_reason text,
  p_changed_by text
)
returns table (scope text, paused boolean, previously_paused boolean)
language plpgsql
as $$
declare
  v_previous boolean;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'set_ops_pause: a reason is required';
  end if;
  if p_changed_by is null or length(trim(p_changed_by)) = 0 then
    raise exception 'set_ops_pause: changed_by is required';
  end if;

  select c.paused into v_previous
  from ops_pause_control c
  where c.scope = p_scope
  for update;
  if not found then
    raise exception 'set_ops_pause: unknown scope %', p_scope;
  end if;

  update ops_pause_control c
  set
    paused = p_paused,
    reason = trim(p_reason),
    changed_by = trim(p_changed_by),
    changed_at = now()
  where c.scope = p_scope;

  insert into ops_pause_event (
    scope, paused, previously_paused, reason, changed_by
  )
  values (p_scope, p_paused, v_previous, trim(p_reason), trim(p_changed_by));

  return query select p_scope, p_paused, v_previous;
end;
$$;

revoke all on function set_ops_pause(text, boolean, text, text) from public;

create table organisation_feature (
  organisation_id uuid not null references organisation (id) on delete cascade,
  feature text not null check (feature ~ '^[a-z][a-z0-9_]{0,63}$'),
  enabled boolean not null default false,
  changed_by text
    check (changed_by is null or length(changed_by) between 1 and 200),
  changed_at timestamptz not null default now(),
  primary key (organisation_id, feature)
);

alter table organisation_feature enable row level security;
alter table organisation_feature force row level security;
create policy tenant_isolation on organisation_feature
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );

revoke all on organisation_feature from public;
grant select on organisation_feature to naba_app_runtime;

insert into schema_migration (version) values ('0090_pause_controls')
on conflict (version) do nothing;

commit;
