import type { TransactionSql } from "postgres"
import { describe, expect, it } from "vitest"

import { withAuditActor, writeAudit } from "@/lib/server/audit"

// `writeAudit` builds one INSERT whose seventh interpolated value is the
// metadata document. A tagged-template stub is enough to read it back: the
// statement's shape is asserted by the integration suite, this file asserts
// what goes into the metadata column.
function captureAudit() {
  const rows: Record<string, unknown>[] = []
  const sql = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
    rows.push(values.at(-1) as Record<string, unknown>)
    return Promise.resolve([])
  }) as unknown as TransactionSql
  ;(sql as unknown as { json: (v: unknown) => unknown }).json = (value) => value
  return { sql, rows }
}

const event = {
  organisationId: "00000000-0000-4000-8000-000000000001",
  action: "review.reply.published",
  subjectType: "review",
  subjectId: "00000000-0000-4000-8000-000000000002",
  requestId: "req-1",
}

describe("writeAudit — support attribution", () => {
  it("leaves metadata untouched outside an impersonated context", async () => {
    const { sql, rows } = captureAudit()
    await writeAudit(sql, { ...event, metadata: { locationId: "loc" } })
    expect(rows[0]).toEqual({ locationId: "loc" })
  })

  // The row stays attributed to the customer's own user id — it belongs to
  // their tenant and their compliance export — so the support engineer is
  // recorded beside it rather than in actor_user_id.
  it("records the support actor and reason for every write inside the context", async () => {
    const { sql, rows } = captureAudit()
    await withAuditActor(
      {
        supportActor: "support@nabapresence.test",
        impersonationReason: "T-42",
      },
      async () => {
        await writeAudit(sql, { ...event, metadata: { locationId: "loc" } })
        await writeAudit(sql, { ...event, action: "legal_hold.released" })
      }
    )
    expect(rows).toEqual([
      {
        locationId: "loc",
        supportActor: "support@nabapresence.test",
        impersonationReason: "T-42",
      },
      {
        supportActor: "support@nabapresence.test",
        impersonationReason: "T-42",
      },
    ])
  })

  it("survives the await boundaries a handler puts between the two", async () => {
    const { sql, rows } = captureAudit()
    await withAuditActor({ supportActor: "s@example.test" }, async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await writeAudit(sql, event)
    })
    expect(rows[0]).toMatchObject({ supportActor: "s@example.test" })
  })

  it("truncates and redacts the merged fields like any other metadata", async () => {
    const { sql, rows } = captureAudit()
    await withAuditActor(
      {
        supportActor: "s@example.test",
        impersonationReason: `Bearer ${"a".repeat(40)}`,
      },
      () => writeAudit(sql, event)
    )
    expect(rows[0].impersonationReason).toBe("Bearer [REDACTED]")

    const long = captureAudit()
    await withAuditActor(
      { supportActor: "s@example.test", impersonationReason: "x".repeat(400) },
      () => writeAudit(long.sql, event)
    )
    expect(long.rows[0].impersonationReason).toHaveLength(200)
  })

  it("lets an explicit actor on the event win over the ambient one", async () => {
    const { sql, rows } = captureAudit()
    await withAuditActor({ supportActor: "ambient@example.test" }, () =>
      writeAudit(sql, { ...event, supportActor: "explicit@example.test" })
    )
    expect(rows[0]).toMatchObject({ supportActor: "explicit@example.test" })
  })

  // A null actor is the normal case for cron, Pub/Sub push and the jobs
  // runner: none of them can be impersonated, and none should grow a pair of
  // null keys in every audit row it writes.
  it("adds no keys when there is no support actor to record", async () => {
    const { sql, rows } = captureAudit()
    await withAuditActor({ impersonationReason: "orphaned" }, () =>
      writeAudit(sql, { ...event, metadata: { a: 1 } })
    )
    expect(rows[0]).toEqual({ a: 1 })
  })
})
