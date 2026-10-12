begin;

-- ---------------------------------------------------------------------------
-- Mutation operation ledger: one receipt per user intent (plan P03-S2).
--
-- The client mints an intent id (a UUID sent as the `Idempotency-Key` header)
-- once per thing a person asked for, and resends it unchanged when it retries
-- after a lost answer. lib/server/mutation-operations.ts records the intent
-- here, in the same transaction that claims the provider attempt and so
-- before anything is sent to Google:
--
--   same intent, same payload hash      -> the stored receipt, no second send
--   same intent, different payload hash -> 409 intent_conflict
--
-- attempt_table/attempt_id link the receipt to the per-surface attempt row
-- that runGbpWrite (lib/server/gbp-write.ts) settles; settling the attempt
-- settles every receipt linked to it, so a receipt left 'sent' by an
-- interrupted request is settled by whichever request recovers the attempt.
--
-- state is the shared outcome vocabulary (lib/contracts/mutation-operations.ts).
-- connection_generation is google_connection.credential_generation when the
-- intent was recorded, so later work can refuse to dispatch on a credential
-- that has since been replaced (lib/server/authz/actor.ts).
--
-- Reserved for later slices, nullable and unused here:
--   approval_ref, security_version   the approval and the actor's security
--                                    version the write went out under
--   recovery_attempts, next_recovery_at, lease_expires_at
--                                    the uncertain-write recovery job
--
-- Rows are kept, never deleted by the app: the runtime role gets select,
-- insert and update only. location_id and google_connection_id outlive their
-- rows as null so the receipt survives an unlink or a deleted location.
-- ---------------------------------------------------------------------------

create table mutation_operation (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  intent_id uuid not null,
  actor_user_id uuid references app_user(id) on delete set null,
  surface text not null check (surface ~ '^[a-z][a-z0-9_]{0,63}$'),
  action text not null check (action ~ '^[a-z][a-z0-9_]{0,63}$'),
  location_id uuid references location(id) on delete set null,
  target_type text check (target_type is null or length(target_type) <= 64),
  target_ref text check (target_ref is null or length(target_ref) <= 512),
  payload_hash text not null check (length(payload_hash) between 16 and 128),
  expected_revision text check (
    expected_revision is null or length(expected_revision) <= 256
  ),
  approval_ref text check (approval_ref is null or length(approval_ref) <= 256),
  security_version integer check (security_version is null or security_version >= 0),
  google_connection_id uuid references google_connection(id) on delete set null,
  connection_generation integer check (
    connection_generation is null or connection_generation >= 1
  ),
  attempt_table text check (
    attempt_table is null or attempt_table ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  attempt_id uuid,
  state text not null default 'sent' check (
    state in (
      'saved_locally',
      'sent',
      'awaiting_confirmation',
      'confirmed_applied',
      'rejected',
      'failed',
      'uncertain'
    )
  ),
  receipt jsonb,
  error_code text check (error_code is null or length(error_code) <= 128),
  recovery_attempts integer not null default 0 check (recovery_attempts >= 0),
  next_recovery_at timestamptz,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mutation_operation_intent_key unique (organisation_id, intent_id)
);

-- Settling an attempt finds the receipts linked to it.
create index mutation_operation_attempt_idx
  on mutation_operation (organisation_id, attempt_table, attempt_id)
  where attempt_id is not null;

-- The recovery job's queue: uncertain receipts, soonest first.
create index mutation_operation_recovery_idx
  on mutation_operation (state, next_recovery_at)
  where state = 'uncertain';

alter table mutation_operation enable row level security;
alter table mutation_operation force row level security;
create policy tenant_isolation on mutation_operation
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );

grant select, insert, update on mutation_operation to naba_app_runtime;

insert into schema_migration (version) values ('0086_mutation_operation')
on conflict (version) do nothing;

commit;
