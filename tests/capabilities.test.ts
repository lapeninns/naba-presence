import type { TransactionSql } from "postgres"
import { describe, expect, it } from "vitest"

import {
  reviewCapabilities,
  reviewCapabilitiesForLocations,
} from "@/lib/server/capabilities"
import type { Session } from "@/lib/server/session"

// These tests exercise the security-critical MEMBER branch of
// reviewCapabilitiesForLocations/reviewCapabilities directly, with a
// stubbed `sql` so the two internal queries (hasAssignments existence
// check, and the per-location `location_member` grants lookup) are fully
// controlled. This is faster and more precise than round-tripping through
// a real Postgres instance for every role x membership permutation.
//
// The stub distinguishes the two queries issued by capabilities.ts by
// inspecting the literal SQL text (each query has a unique column alias),
// and separately supports `sql(array)` being called as a plain function
// (not as a tagged template) to build the `location_id in (...)` fragment
// -- postgres.js's real `sql` export supports both call shapes, and
// capabilities.ts relies on both.

type FakeQueryScript = {
  hasAssignments: boolean
  grants: { locationId: string; canPublish: boolean }[]
}

function isTaggedTemplateCall(
  value: unknown
): value is TemplateStringsArray {
  return Array.isArray(value) && "raw" in value
}

function createFakeSql(script: FakeQueryScript): TransactionSql {
  const fn = (first: unknown) => {
    if (isTaggedTemplateCall(first)) {
      const text = first.join("¦")
      if (text.includes('as "hasAssignments"')) {
        return Promise.resolve([{ hasAssignments: script.hasAssignments }])
      }
      if (text.includes('as "locationId"')) {
        return Promise.resolve(script.grants)
      }
      throw new Error(`FakeSql: unexpected query -- ${text}`)
    }
    // sql(array) fragment-builder call, e.g. `location_id in ${sql(unique)}`.
    // The stub doesn't need to render real SQL for it -- it only needs to
    // exist as a callable so the interpolation doesn't throw.
    return first
  }
  return fn as unknown as TransactionSql
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: "session-1",
    userId: "user-1",
    organisationId: "org-1",
    organisationName: "Org",
    displayName: "Test User",
    email: "test@example.test",
    role: "member",
    canPublish: true,
    ...overrides,
  }
}

const LOCATION_A = "11111111-1111-4111-8111-111111111111"
const LOCATION_B = "22222222-2222-4222-8222-222222222222"

describe("reviewCapabilities -- member branch (mirrors permissions.ts)", () => {
  it("case 1: member ASSIGNED to the location with can_publish=false -> canPublish false, canEdit true", async () => {
    const session = makeSession({ canPublish: true })
    const sql = createFakeSql({
      hasAssignments: true,
      grants: [{ locationId: LOCATION_A, canPublish: false }],
    })

    const result = await reviewCapabilities(sql, session, LOCATION_A)

    expect(result).toEqual({ canPublish: false, canEdit: true })
  })

  it("case 2: member with assignments elsewhere but NOT assigned to this location -> canPublish false, canEdit false", async () => {
    const session = makeSession({ canPublish: true })
    // hasAssignments is true (the member has at least one location_member
    // row somewhere), but the grants query for LOCATION_B returns nothing
    // -- exactly what happens when the member is assigned to a different
    // location than the one being checked.
    const sql = createFakeSql({
      hasAssignments: true,
      grants: [],
    })

    const result = await reviewCapabilities(sql, session, LOCATION_B)

    expect(result).toEqual({ canPublish: false, canEdit: false })
  })

  it.each([true, false])(
    "case 3: member with NO assignments at all falls back to session.canPublish=%s, canEdit true",
    async (canPublish) => {
      const session = makeSession({ canPublish })
      const sql = createFakeSql({ hasAssignments: false, grants: [] })

      const result = await reviewCapabilities(sql, session, LOCATION_A)

      expect(result).toEqual({ canPublish, canEdit: true })
    }
  )

  it("batches multiple locations in one call, deduping repeats, mixing assigned and unassigned", async () => {
    const session = makeSession({ canPublish: true })
    const sql = createFakeSql({
      hasAssignments: true,
      grants: [{ locationId: LOCATION_A, canPublish: true }],
    })

    const result = await reviewCapabilitiesForLocations(sql, session, [
      LOCATION_A,
      LOCATION_B,
      LOCATION_A,
    ])

    expect(result.size).toBe(2)
    expect(result.get(LOCATION_A)).toEqual({ canPublish: true, canEdit: true })
    expect(result.get(LOCATION_B)).toEqual({
      canPublish: false,
      canEdit: false,
    })
  })
})
