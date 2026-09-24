begin;

-- ---------------------------------------------------------------------------
-- Shareable, read-only client report links.
--
-- Agencies send each client its monthly numbers. Until now that meant
-- screenshots of Reports. A report share is a link an owner or admin sends a
-- client: it shows that one client's aggregate report, read-only, with no
-- account.
--
-- report_share
--   One row per link. Only the SHA-256 of the token is stored: the token is
--   shown once when the link is created and cannot be recovered afterwards
--   (unlike invitations, which keep a ciphertext so the link can be copied
--   again; a report link that outlives the dialog it was made in has no
--   second use worth the extra secret at rest). Every link expires
--   (expires_at is NOT NULL) and can be revoked at any time (revoked_at);
--   neither deletes the row, so the audit trail and the list of links stay
--   whole.
--
-- lookup_report_share(token_hash)
--   The holder of a link has no session, so the token is resolved before any
--   tenant is known -- the same shape as lookup_invitation (0008). SECURITY
--   DEFINER, ids only, and it answers ONLY for a link that is live: not
--   revoked, not expired, and whose client is not archived. A revoked, an
--   expired and a made-up token therefore all return no row, so the caller
--   cannot tell them apart and neither can anyone probing it. The report
--   itself is then read inside withTenant(organisation_id), under RLS, scoped
--   to client_id (lib/server/shared-report.ts). The view counter is written
--   the same way, through RLS, by the runtime role's ordinary update grant.
-- ---------------------------------------------------------------------------

create table report_share (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  client_id uuid not null references client(id) on delete cascade,
  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references app_user(id) on delete set null,
  last_viewed_at timestamptz,
  view_count integer not null default 0 check (view_count >= 0),
  check (expires_at > created_at)
);

create index report_share_client_idx
  on report_share (organisation_id, client_id, created_at desc);

alter table report_share enable row level security;
alter table report_share force row level security;
create policy tenant_isolation on report_share
  using (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  )
  with check (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
  );

-- No delete: revoking sets revoked_at, and an organisation's own deletion
-- cascades as the migration owner.
grant select, insert, update on report_share to naba_app_runtime;

create function lookup_report_share(p_token_hash text)
returns table (
  share_id uuid,
  organisation_id uuid,
  client_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.organisation_id, s.client_id
  from report_share s
  join client c
    on c.id = s.client_id
   and c.organisation_id = s.organisation_id
  where s.token_hash = p_token_hash
    and s.revoked_at is null
    and s.expires_at > now()
    and c.archived_at is null
  limit 1;
$$;

revoke all on function lookup_report_share(text) from public;
grant execute on function lookup_report_share(text) to naba_app_runtime;

insert into schema_migration (version) values ('0057_report_share')
on conflict (version) do nothing;

commit;
