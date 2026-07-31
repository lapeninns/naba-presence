import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("unsupported Q&A removal migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/0025_remove_unsupported_qa.sql"),
    "utf8"
  )

  it("removes obsolete data and excludes Q&A from reconciliation", () => {
    expect(migration).toContain("delete from presence_resource_reconcile_state where resource = 'qa'")
    expect(migration).toContain("drop table if exists qa_answer_attempt")
    expect(migration).toContain("drop table if exists qa_answer_draft")
    expect(migration).toContain("drop table if exists gbp_question")
    expect(migration).not.toContain("'placeActions', 'qa'")
  })
})
