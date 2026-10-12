import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { ORG_FEATURES } from "@/lib/contracts/org-features"
import { retentionDataset } from "@/lib/server/retention/inventory"

describe("Invitation delivery migration (0104)", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/0104_invitation_delivery.sql"),
    "utf8"
  )

  it("creates one delivery table with the shared driver's states", () => {
    expect(migration).toMatch(/create table invitation_delivery \(/)
    expect(migration).toContain(
      "check (status in ('pending', 'sent', 'failed', 'suppressed', 'uncertain'))"
    )
    expect(migration).toContain(
      "may_have_sent boolean not null default false"
    )
    expect(migration).toContain("check (kind in ('initial', 'resend'))")
  })

  it("ties a delivery to an invitation of its own organisation and goes with it", () => {
    expect(migration).toMatch(
      /foreign key \(organisation_id, invitation_id\)\s+references invitation \(organisation_id, id\) on delete cascade/
    )
    expect(migration).toContain(
      "add constraint invitation_organisation_id_id_key\n  unique (organisation_id, id)"
    )
  })

  it("allows one pending email per invitation", () => {
    expect(migration).toMatch(
      /create unique index invitation_delivery_one_pending_idx\s+on invitation_delivery \(invitation_id\)\s+where status = 'pending'/
    )
  })

  it("isolates tenants with forced RLS and grants the runtime role", () => {
    expect(migration).toContain(
      "alter table invitation_delivery enable row level security;"
    )
    expect(migration).toContain(
      "alter table invitation_delivery force row level security;"
    )
    expect(migration).toMatch(
      /create policy tenant_isolation on invitation_delivery\s+using \(\s+organisation_id = nullif\(current_setting\('app.organisation_id', true\), ''\)::uuid/
    )
    expect(migration).toContain(
      "grant select, insert, update, delete on invitation_delivery to naba_app_runtime;"
    )
  })

  it("exposes only due organisation ids across tenants", () => {
    expect(migration).toMatch(
      /create or replace function invitation_delivery_due_organisations\(p_limit integer\)\s+returns table \(organisation_id uuid\)\s+language sql stable security definer set search_path = public/
    )
    expect(migration).toContain(
      "revoke all on function invitation_delivery_due_organisations(integer)\n  from public;"
    )
  })

  it("records its version in one transaction", () => {
    expect(migration.trim().startsWith("begin;")).toBe(true)
    expect(migration.trim().endsWith("commit;")).toBe(true)
    expect(migration).toContain("values ('0104_invitation_delivery')")
  })

  it("ships dark behind its own organisation feature and is classified for retention", () => {
    expect(ORG_FEATURES).toContain("invitation_email")
    expect(retentionDataset("invitation_delivery")).toMatchObject({
      action: "keep",
      deletes: "none",
    })
  })
})
