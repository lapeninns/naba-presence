begin;

-- ---------------------------------------------------------------------------
-- App-sent invitation email (plan P06-6).
--
-- Until now an invitation was a link the inviter copied and sent themselves.
-- invitation_delivery is one row per email the app tries to send for an
-- invitation: the first when it is created, and one per Resend. It is
-- claimed, sent and settled by the shared email driver
-- (lib/server/notifications/delivery.ts), each send carrying the row's own
-- idempotency key (invitation-delivery/<id>), and drained by the job tick
-- under the `invitation_email` pause scope.
--
-- status (as notification_delivery and platform_incident_delivery, 0095):
--   pending     due at next_attempt_at
--   sent        the provider accepted it
--   failed      the provider certainly did not accept it
--   suppressed  deliberately not sent: no provider configured, tenant email
--               switched off, the abuse limit, or the invitation was accepted
--               or expired before it went out
--   uncertain   it may have gone out and no idempotent retry is left
-- may_have_sent is the sticky mark 0096 added to the other two queues.
--
-- kind: `initial` (written by POST /api/invitations) or `resend`.
-- requested_by: who asked for this send; null once that user is deleted.
--
-- At most one pending row per invitation, so a Resend while a send is still
-- queued is refused rather than queued twice. Rows go with their invitation:
-- revoking it deletes them. The composite key ties a delivery to an
-- invitation of its own organisation whatever RLS the writer runs under.
--
-- invitation_delivery_due_organisations is the job tick's one cross-tenant
-- read: which organisations have due rows. Each is then claimed and sent
-- inside that organisation's tenant transaction.
-- ---------------------------------------------------------------------------

alter table invitation
  add constraint invitation_organisation_id_id_key
  unique (organisation_id, id);

create table invitation_delivery (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  invitation_id uuid not null,
  requested_by uuid references app_user(id) on delete set null,
  kind text not null default 'initial' check (kind in ('initial', 'resend')),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'suppressed', 'uncertain')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz default now(),
  last_error_code text
    check (last_error_code is null or length(last_error_code) <= 120),
  provider_message_id text,
  may_have_sent boolean not null default false,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organisation_id, invitation_id)
    references invitation (organisation_id, id) on delete cascade
);

create unique index invitation_delivery_one_pending_idx
  on invitation_delivery (invitation_id)
  where status = 'pending';

create index invitation_delivery_due_idx
  on invitation_delivery (organisation_id, next_attempt_at)
  where status = 'pending';

create index invitation_delivery_fleet_due_idx
  on invitation_delivery (next_attempt_at)
  where status = 'pending';

create index invitation_delivery_invitation_idx
  on invitation_delivery (organisation_id, invitation_id, created_at desc);

alter table invitation_delivery enable row level security;
alter table invitation_delivery force row level security;
create policy tenant_isolation on invitation_delivery
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );
grant select, insert, update, delete on invitation_delivery to naba_app_runtime;

-- Organisations with invitation email due now, oldest due first. Names no
-- row and returns nothing but organisation ids.
create or replace function invitation_delivery_due_organisations(p_limit integer)
returns table (organisation_id uuid)
language sql stable security definer set search_path = public as $$
  select d.organisation_id
  from invitation_delivery d
  where d.status = 'pending'
    and d.next_attempt_at <= now()
  group by d.organisation_id
  order by min(d.next_attempt_at)
  limit p_limit
$$;

revoke all on function invitation_delivery_due_organisations(integer)
  from public;
grant execute on function invitation_delivery_due_organisations(integer)
  to naba_app_runtime;

insert into schema_migration (version)
values ('0104_invitation_delivery')
on conflict (version) do nothing;

commit;
