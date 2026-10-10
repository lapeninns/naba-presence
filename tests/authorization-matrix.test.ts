import type { TransactionSql } from "postgres"
import { describe, expect, it } from "vitest"

import {
  actorScopeFromMembership,
  recheckAuthorisation,
} from "@/lib/server/authz/actor"
import { locationActionCapabilities } from "@/lib/server/capabilities"
import { ApiError } from "@/lib/server/http"
import {
  actionAllowed,
  LOCATION_ACTIONS,
  requireLocationAction,
  type GrantScope,
  type LocationAction,
} from "@/lib/server/permissions"

// The role x action matrix for lib/server/permissions.ts actionAllowed and
// requireLocationAction, and the session-free actor built on it
// (lib/server/authz/actor.ts). The table below is the product rule written
// out by hand; the tests derive nothing from the implementation.

const LOCATION = "11111111-1111-4111-8111-111111111111"
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORG = "99999999-9999-4999-8999-999999999999"
const CONNECTION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

type Actor = {
  name: string
  scope: GrantScope
}

const ACTORS: Actor[] = [
  { name: "owner", scope: { userId: USER, role: "owner", canPublish: false } },
  { name: "admin", scope: { userId: USER, role: "admin", canPublish: false } },
  {
    name: "publishing member",
    scope: { userId: USER, role: "member", canPublish: true },
  },
  {
    name: "drafting member",
    scope: { userId: USER, role: "member", canPublish: false },
  },
  // A viewer's organisation-level can_publish must not matter.
  { name: "viewer", scope: { userId: USER, role: "viewer", canPublish: true } },
]

const Y = true
const N = false
// read, edit, request_approval, triage, assign, decide_approval, publish
const EXPECTED: Record<string, Record<LocationAction, boolean>> = {
  owner: row(Y, Y, Y, Y, Y, Y, Y),
  admin: row(Y, Y, Y, Y, Y, Y, Y),
  "publishing member": row(Y, Y, Y, Y, Y, Y, Y),
  "drafting member": row(Y, Y, Y, Y, Y, N, N),
  viewer: row(Y, N, N, N, N, N, N),
}

function row(...allowed: boolean[]): Record<LocationAction, boolean> {
  return Object.fromEntries(
    LOCATION_ACTIONS.map((action, index) => [action, allowed[index]])
  ) as Record<LocationAction, boolean>
}

/**
 * A scripted `sql` for the three queries these modules issue: the grantsFor
 * batch read, the member row, and the active link's connection.
 */
function scriptedSql(script: {
  locationScope?: "all" | "assigned" | null
  grants?: Record<string, boolean> | null
  member?: { role: GrantScope["role"]; canPublish: boolean } | null
  connectionId?: string | null
  /** The active connection's credential_generation (default 1). */
  generation?: number | null
  policy?: { approvalRequired: boolean; requireTwoPersonApproval: boolean } | null
}) {
  const queries: string[] = []
  const fn = (first: unknown) => {
    if (!Array.isArray(first) || !("raw" in first)) return { first }
    const text = (first as unknown as string[]).join("?")
    return {
      then(onFulfilled: (rows: unknown[]) => unknown) {
        queries.push(text)
        let rows: unknown[]
        if (text.includes('as "locationScope"')) {
          rows = [
            {
              locationScope:
                script.locationScope === undefined
                  ? "all"
                  : script.locationScope,
              grants: script.grants ?? null,
            },
          ]
        } else if (text.includes("from member")) {
          rows = script.member ? [script.member] : []
        } else if (text.includes("from organisation")) {
          rows = script.policy ? [script.policy] : []
        } else if (text.includes("from location_link")) {
          rows =
            script.connectionId === undefined
              ? []
              : [
                  {
                    connectionId: script.connectionId,
                    generation:
                      script.generation === undefined ? 1 : script.generation,
                  },
                ]
        } else {
          throw new Error(`scriptedSql: unexpected query -- ${text}`)
        }
        return Promise.resolve(rows).then(onFulfilled)
      },
    }
  }
  return { sql: fn as unknown as TransactionSql, queries }
}

describe("actionAllowed -- role x action", () => {
  for (const actor of ACTORS) {
    describe(actor.name, () => {
      it.each(LOCATION_ACTIONS.map((action) => [action] as const))(
        "%s",
        async (action) => {
          // Members on scope 'all' see every location and publish by the
          // organisation flag; this is the grant grantsFor builds for them.
          const { sql } = scriptedSql({ locationScope: "all" })
          const expected = EXPECTED[actor.name][action]
          const call = requireLocationAction(sql, actor.scope, LOCATION, action)
          if (expected) {
            await expect(call).resolves.toMatchObject({ visible: true })
          } else {
            await expect(call).rejects.toMatchObject({
              status: 403,
              code: "permission_denied",
            })
          }
        }
      )
    })
  }

  it("refuses every action, read included, on a hidden location", () => {
    const hidden = { visible: false, canEdit: true, canPublish: true }
    for (const actor of ACTORS) {
      for (const action of LOCATION_ACTIONS) {
        expect(actionAllowed(actor.scope.role, hidden, action)).toBe(false)
      }
    }
  })

  it("never lets a viewer past read, whatever the grant claims", () => {
    const full = { visible: true, canEdit: true, canPublish: true }
    for (const action of LOCATION_ACTIONS) {
      expect(actionAllowed("viewer", full, action)).toBe(action === "read")
    }
  })
})

// The UI's per-location action flags must say exactly what the routes
// accept, so a viewer or drafting member is never shown a control that 403s.
describe("locationActionCapabilities -- the UI projection of the matrix", () => {
  it.each(ACTORS.map((actor) => [actor.name, actor] as const))(
    "%s",
    (name, actor) => {
      const grant = {
        visible: true,
        canEdit: actor.scope.role !== "viewer",
        canPublish: actor.scope.role !== "viewer" && (
          actor.scope.role === "owner" ||
          actor.scope.role === "admin" ||
          actor.scope.canPublish
        ),
      }
      const expected = EXPECTED[name]
      expect(locationActionCapabilities(actor.scope.role, grant)).toEqual({
        canEdit: expected.edit,
        canRequestApproval: expected.request_approval && !expected.publish,
        canDecideApproval: expected.decide_approval,
      })
    }
  )

  it("grants nothing on a hidden location", () => {
    expect(
      locationActionCapabilities("owner", {
        visible: false,
        canEdit: true,
        canPublish: true,
      })
    ).toEqual({
      canEdit: false,
      canRequestApproval: false,
      canDecideApproval: false,
    })
  })
})

describe("requireLocationAction -- grants from location_member rows", () => {
  const member: GrantScope = { userId: USER, role: "member", canPublish: true }

  it("404s (not 403) a location outside the member's assignments", async () => {
    const { sql } = scriptedSql({ locationScope: "assigned", grants: {} })
    const error = await requireLocationAction(sql, member, LOCATION, "read", {
      code: "location_not_found",
      message: "Location not found.",
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 404, code: "location_not_found" })
  })

  it("keeps the legacy 404 code when the caller names none", async () => {
    const { sql } = scriptedSql({ locationScope: "assigned", grants: {} })
    await expect(
      requireLocationAction(sql, member, LOCATION, "edit")
    ).rejects.toMatchObject({ status: 404, code: "review_not_found" })
  })

  it("uses the assigned row's can_publish, not the organisation flag", async () => {
    const { sql } = scriptedSql({
      locationScope: "assigned",
      grants: { [LOCATION]: false },
    })
    await expect(
      requireLocationAction(sql, member, LOCATION, "edit")
    ).resolves.toMatchObject({ canEdit: true, canPublish: false })
    await expect(
      requireLocationAction(sql, member, LOCATION, "publish")
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      requireLocationAction(sql, member, LOCATION, "decide_approval")
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe("authz/actor -- session-free actor", () => {
  it("builds a GrantScope from the member row", async () => {
    const { sql } = scriptedSql({
      member: { role: "member", canPublish: true },
    })
    await expect(actorScopeFromMembership(sql, ORG, USER)).resolves.toEqual({
      userId: USER,
      role: "member",
      canPublish: true,
    })
  })

  it("answers null for someone who is not a member", async () => {
    const { sql } = scriptedSql({ member: null })
    await expect(actorScopeFromMembership(sql, ORG, USER)).resolves.toBeNull()
  })

  const recheck = (
    script: Parameters<typeof scriptedSql>[0],
    extra: Partial<Parameters<typeof recheckAuthorisation>[1]> = {}
  ) =>
    recheckAuthorisation(scriptedSql(script).sql, {
      organisationId: ORG,
      actorUserId: USER,
      locationId: LOCATION,
      action: "publish",
      ...extra,
    })

  it("refuses an actor who has left the organisation", async () => {
    await expect(recheck({ member: null })).resolves.toEqual({
      ok: false,
      reason: "actor_not_member",
    })
  })

  it("refuses a location the actor can no longer see", async () => {
    await expect(
      recheck({
        member: { role: "member", canPublish: true },
        locationScope: "assigned",
        grants: {},
      })
    ).resolves.toEqual({ ok: false, reason: "location_hidden" })
  })

  it("refuses an actor demoted to viewer since the work was queued", async () => {
    await expect(
      recheck({ member: { role: "viewer", canPublish: true } })
    ).resolves.toEqual({ ok: false, reason: "action_denied" })
  })

  it("refuses when the location now links through another connection", async () => {
    await expect(
      recheck(
        {
          member: { role: "owner", canPublish: false },
          connectionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        },
        { connectionId: CONNECTION }
      )
    ).resolves.toEqual({ ok: false, reason: "connection_changed" })
    await expect(
      recheck(
        { member: { role: "owner", canPublish: false } },
        { connectionId: CONNECTION }
      )
    ).resolves.toEqual({ ok: false, reason: "connection_changed" })
  })

  it("fails closed on a security version it cannot verify yet", async () => {
    await expect(
      recheck(
        { member: { role: "owner", canPublish: false } },
        {
          securityVersion: 3,
        }
      )
    ).resolves.toEqual({ ok: false, reason: "security_version_unverifiable" })
  })

  it("refuses when the connection's credential generation moved on", async () => {
    const owner = { role: "owner" as const, canPublish: false }
    await expect(
      recheck(
        { member: owner, connectionId: CONNECTION, generation: 3 },
        { connectionId: CONNECTION, generation: 2 }
      )
    ).resolves.toEqual({ ok: false, reason: "generation_changed" })
    // No active link at all: the generation cannot be proven.
    await expect(
      recheck({ member: owner }, { generation: 2 })
    ).resolves.toEqual({ ok: false, reason: "generation_changed" })
    await expect(
      recheck(
        { member: owner, connectionId: CONNECTION, generation: 2 },
        { connectionId: CONNECTION, generation: 2 }
      )
    ).resolves.toMatchObject({ ok: true })
  })

  it("fails closed on an entitlement it cannot verify yet", async () => {
    const owner = { member: { role: "owner" as const, canPublish: false } }
    await expect(
      recheck(owner, { entitlement: "scheduled_post" })
    ).resolves.toEqual({ ok: false, reason: "entitlement_unverifiable" })
  })

  it("refuses when the approval policy changed since the work was queued", async () => {
    const queued = { approvalRequired: false, requireTwoPersonApproval: false }
    await expect(
      recheck(
        {
          member: { role: "owner", canPublish: false },
          policy: { approvalRequired: true, requireTwoPersonApproval: false },
        },
        { policy: queued }
      )
    ).resolves.toEqual({ ok: false, reason: "policy_changed" })
    await expect(
      recheck(
        { member: { role: "owner", canPublish: false }, policy: queued },
        { policy: queued }
      )
    ).resolves.toMatchObject({ ok: true })
  })

  it("passes an actor who still holds the action, returning the scope", async () => {
    await expect(
      recheck(
        {
          member: { role: "member", canPublish: false },
          locationScope: "assigned",
          grants: { [LOCATION]: true },
          connectionId: CONNECTION.toUpperCase(),
        },
        { connectionId: CONNECTION }
      )
    ).resolves.toEqual({
      ok: true,
      scope: { userId: USER, role: "member", canPublish: false },
      grant: { visible: true, canEdit: true, canPublish: true },
    })
  })
})
