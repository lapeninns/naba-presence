import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { sessionSchema } from "@/lib/contracts/session"

describe("Workspace mode migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/0061_workspace_mode.sql"),
    "utf8"
  )

  it("adds the mode with agency as the safe default and a single home client", () => {
    expect(migration).toMatch(
      /add column workspace_mode text not null\s+default 'agency' check \(workspace_mode in \('business', 'agency'\)\)/
    )
    expect(migration).toContain(
      "create unique index client_one_home on client (organisation_id) where is_home"
    )
  })

  it("keeps organisations with more than one client in agency mode untouched", () => {
    expect(migration).toMatch(
      /if client_total > 1 then\s+update organisation set workspace_mode = 'agency'[\s\S]*?continue;/
    )
  })

  it("never restores an archived sole client and uniquifies the home slug", () => {
    expect(migration).not.toContain("archived_at = null")
    expect(migration).toContain("sole_archived is not null")
    expect(migration).toContain("base_slug := base_slug || '-home'")
  })

  it("warns about shares and guards the home client in the database", () => {
    expect(migration).toContain("report_share")
    expect(migration).toContain("create trigger client_guard_home")
    expect(migration).toContain("create trigger location_guard_home")
  })

  it("records its version in one transaction", () => {
    expect(migration.trim().startsWith("begin;")).toBe(true)
    expect(migration.trim().endsWith("commit;")).toBe(true)
    expect(migration).toContain("values ('0061_workspace_mode')")
  })
})

describe("sessionSchema workspaceMode", () => {
  const base = {
    userId: "u",
    organisationId: "o",
    organisationName: "Org",
    displayName: "D",
    email: "d@example.test",
    role: "owner",
    canPublish: true,
  }

  it("carries the mode through", () => {
    expect(
      sessionSchema.parse({ ...base, workspaceMode: "business" }).workspaceMode
    ).toBe("business")
    expect(
      sessionSchema.parse({ ...base, workspaceMode: "agency" }).workspaceMode
    ).toBe("agency")
  })

  it("rejects a session without a valid mode", () => {
    expect(sessionSchema.safeParse(base).success).toBe(false)
    expect(
      sessionSchema.safeParse({ ...base, workspaceMode: "team" }).success
    ).toBe(false)
  })
})
