import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("Invitation client scope migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/0056_invitation_client_scope.sql"),
    "utf8"
  )

  it("adds client_ids to invitation, with no second membership table", () => {
    expect(migration).toContain(
      "alter table invitation add column client_ids uuid[]"
    )
    expect(migration).not.toMatch(/create table/i)
  })

  it("forbids an empty scope and a scope on owners or admins", () => {
    expect(migration).toMatch(
      /client_ids is null\s+or \(cardinality\(client_ids\) > 0 and role in \('member', 'viewer'\)\)/
    )
  })

  it("records its version in one transaction", () => {
    expect(migration.trim().startsWith("begin;")).toBe(true)
    expect(migration.trim().endsWith("commit;")).toBe(true)
    expect(migration).toContain("values ('0056_invitation_client_scope')")
  })
})
