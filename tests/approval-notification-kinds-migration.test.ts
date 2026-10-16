import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import {
  ADDRESSED_KINDS,
  NOTIFICATION_EVENT_KINDS,
} from "@/lib/domain/notification-preferences"
import { contractOperations } from "../scripts/migration-rules.mjs"
import { retentionDataset } from "@/lib/server/retention/inventory"
import { REQUIRED_MIGRATIONS } from "@/lib/server/schema-manifest"

describe("Approval notification kinds migration (0149)", () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/0149_approval_notification_kinds.sql"
    ),
    "utf8"
  )

  it("allows exactly the kinds the app knows, the approval kinds included", () => {
    const check = /check \(\s*kind in \(([^)]*)\)\s*\) not valid;/.exec(
      migration
    )
    expect(check, "kind check").not.toBeNull()
    const allowed = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect(new Set(allowed)).toEqual(new Set(NOTIFICATION_EVENT_KINDS))
    expect(allowed).toHaveLength(NOTIFICATION_EVENT_KINDS.length)
    for (const kind of ADDRESSED_KINDS) expect(allowed).toContain(kind)
  })

  it("widens the check without holding the table's lock for the scan", () => {
    expect(migration).toContain(
      "alter table notification_incident\n  validate constraint notification_incident_kind_check;"
    )
    expect(contractOperations(migration)).toEqual([])
  })

  it("addresses incidents through a tenant table that goes with the incident and the person", () => {
    expect(migration).toMatch(
      /incident_id uuid not null references notification_incident\(id\) on delete cascade/
    )
    expect(migration).toMatch(
      /user_id uuid not null references app_user\(id\) on delete cascade/
    )
    expect(migration).toContain(
      "alter table notification_incident_recipient force row level security;"
    )
    expect(migration).toMatch(
      /create policy tenant_isolation on notification_incident_recipient\s+using \(organisation_id = nullif\(current_setting\('app.organisation_id', true\), ''\)::uuid\)/
    )
    expect(migration).toContain(
      "grant select, insert, delete on notification_incident_recipient to naba_app_runtime;"
    )
    expect(
      retentionDataset("notification_incident_recipient")?.approval
    ).toEqual({ status: "lifecycle" })
  })

  it("records itself and is required by the app", () => {
    expect(migration).toContain(
      "insert into schema_migration(version) values ('0149_approval_notification_kinds')"
    )
    expect(REQUIRED_MIGRATIONS).toContain("0149_approval_notification_kinds")
  })
})
