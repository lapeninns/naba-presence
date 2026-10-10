import { describe, expect, it } from "vitest"

import { operationalEmailMode, operationalEventSchema, operationalSubjectKey, OPERATIONAL_EVENT_POLICY } from "@/lib/contracts/operational-events"

const organisationId = "11111111-1111-4111-8111-111111111111"
const locationId = "22222222-2222-4222-8222-222222222222"
const id = "33333333-3333-4333-8333-333333333333"
const base = { version: 1, organisationId, target: { type: "location", locationId }, occurredAt: "2026-09-29T12:00:00Z" }
const unresolved = { ...base, kind: "publication_unresolved", source: { type: "attempt", family: "lodging", id }, reason: "response_ambiguous" }

describe("operational event contracts", () => {
  it("keeps recovery identity stable and separates tenants and write families", () => {
    const before = operationalEventSchema.parse(unresolved)
    const after = operationalEventSchema.parse({ ...base, kind: "publication_confirmed", source: unresolved.source })
    expect(operationalSubjectKey(after)).toBe(operationalSubjectKey(before))
    expect(OPERATIONAL_EVENT_POLICY[after.kind].resolves).toBe(OPERATIONAL_EVENT_POLICY[before.kind].incident)
    const otherTenant = operationalEventSchema.parse({ ...unresolved, organisationId: id })
    const otherFamily = operationalEventSchema.parse({ ...unresolved, source: { ...unresolved.source, family: "posts" } })
    expect(operationalSubjectKey(otherTenant)).not.toBe(operationalSubjectKey(before))
    expect(operationalSubjectKey(otherFamily)).not.toBe(operationalSubjectKey(before))
  })

  it("rejects raw provider errors, PINs and incompatible source types", () => {
    expect(operationalEventSchema.safeParse({ ...unresolved, providerResponse: { token: "secret" } }).success).toBe(false)
    expect(operationalEventSchema.safeParse({ ...unresolved, reason: "raw Google error" }).success).toBe(false)
    expect(operationalEventSchema.safeParse({ ...unresolved, source: { type: "resource", family: "lodging" } }).success).toBe(false)
    expect(operationalEventSchema.safeParse({ ...base, kind: "verification_changed", source: { type: "verification", id }, state: "pending", pin: "12345" }).success).toBe(false)
  })

  it("requires explicit optional email preferences and does not email recovery", () => {
    const failed = operationalEventSchema.parse({ ...unresolved, kind: "publication_failed", reason: "provider_rejected" })
    expect(operationalEmailMode(failed, false)).toBe("none")
    expect(operationalEmailMode(failed, true)).toBe("immediate")
    const confirmed = operationalEventSchema.parse({ ...base, kind: "publication_confirmed", source: unresolved.source })
    expect(operationalEmailMode(confirmed, true)).toBe("none")
  })

  it("requires a failure and bounds total batch results to the frozen 100 targets", () => {
    const batch = { ...base, kind: "bulk_completed_with_failures", source: { type: "bulk", id }, succeeded: 99, failed: 1, skipped: 0 }
    expect(operationalEventSchema.safeParse(batch).success).toBe(true)
    expect(operationalEventSchema.safeParse({ ...batch, skipped: 1 }).success).toBe(false)
    expect(operationalEventSchema.safeParse({ ...batch, failed: 0 }).success).toBe(false)
  })

  it("retains unknown freshness and pairs stale and recovered observations", () => {
    const source = { type: "resource", family: "hours" }
    const stale = operationalEventSchema.parse({ ...base, source, kind: "resource_stale", lastSuccessfulFetchAt: null })
    const recovered = operationalEventSchema.parse({ ...base, source, kind: "resource_recovered", lastSuccessfulFetchAt: base.occurredAt })
    expect(operationalSubjectKey(stale)).toBe(operationalSubjectKey(recovered))
    expect(operationalEventSchema.safeParse({ ...recovered, lastSuccessfulFetchAt: null }).success).toBe(false)
  })
})
