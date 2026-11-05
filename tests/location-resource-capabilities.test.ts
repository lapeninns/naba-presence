import type { TransactionSql } from "postgres"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { deriveAccess } from "@/lib/domain/entitlements"
import {
  editDisabledReason,
  resourceDisabledReason,
} from "@/lib/locations/gating"
import { locationCapabilitiesForIds } from "@/lib/server/capabilities"
import { NO_PAUSES } from "@/lib/server/pause-controls"
import type { Session } from "@/lib/server/session"

const { env, grantsFor } = vi.hoisted(() => ({
  env: {
    PUBLISH_ENABLED: true,
    GBP_PROFILE_WRITES_ENABLED: true,
    GBP_POSTS_ENABLED: true,
    GBP_MEDIA_ENABLED: true,
    GBP_PLACE_ACTIONS_ENABLED: true,
    GBP_FOOD_MENUS_ENABLED: true,
    GBP_PERFORMANCE_ENABLED: true,
    GBP_KEYWORDS_ENABLED: true,
  },
  grantsFor: vi.fn(),
}))
vi.mock("@/lib/server/env", async (original) => ({
  ...(await original<typeof import("@/lib/server/env")>()),
  getServerEnv: () => env,
}))
vi.mock("@/lib/server/permissions", async (original) => ({
  ...(await original<typeof import("@/lib/server/permissions")>()),
  grantsFor,
}))

const id = "11111111-1111-4111-8111-111111111111"
const session: Session = {
  sessionId: "s",
  userId: "u",
  organisationId: "o",
  organisationName: "Org",
  workspaceMode: "business",
  displayName: "Owner",
  email: "owner@example.test",
  role: "owner",
  canPublish: true,
}

async function capabilities(
  input: {
    linked?: boolean
    connected?: boolean
    verified?: boolean
    session?: Session
  } = {}
) {
  const sql = ((query: unknown) =>
    Array.isArray(query) && "raw" in query
      ? Promise.resolve(
          input.linked === false
            ? []
            : [
                {
                  locationId: id,
                  connected: input.connected ?? true,
                  verified: input.verified ?? true,
                },
              ]
        )
      : query) as unknown as TransactionSql
  return (
    await locationCapabilitiesForIds(
      sql,
      input.session ?? session,
      [id],
      NO_PAUSES
    )
  ).get(id)!
}

beforeEach(() => {
  env.PUBLISH_ENABLED = true
  grantsFor.mockResolvedValue(
    new Map([[id, { visible: true, canPublish: true }]])
  )
})

describe("listing editor provider availability", () => {
  it("keeps local edits and role authority while a linked Google login requires reconnection", async () => {
    const caps = await capabilities({ connected: false })
    expect(caps).toMatchObject({
      canEditCanonical: true,
      canPublish: true,
      canWrite: true,
    })
    expect(caps.resources?.hours).toEqual({
      state: "readOnly",
      reasonCode: "reconnect_required",
    })
    expect(caps.resources?.performance).toEqual({
      state: "readOnly",
      reasonCode: "reconnect_required",
    })
    expect(
      caps.resourceActions?.actions["businessInformation.patch"]
    ).toMatchObject({ canWrite: false, reasonCode: "reconnect_required" })
    expect(editDisabledReason(caps)).toBeNull()
    expect(resourceDisabledReason(caps, "hours", true)).toMatch(/reconnect/i)
  })

  it("keeps an absent link distinct from a disconnected login", async () => {
    expect((await capabilities({ linked: false })).resources?.hours).toEqual({
      state: "unavailable",
      reasonCode: "google_location_not_linked",
    })
  })

  it("projects verification as advice and never retires a complete editor", async () => {
    const caps = await capabilities({ verified: false })
    expect(caps.resources?.hours).toEqual({
      state: "available",
      advisoryCode: "verification_unconfirmed",
    })
    expect(resourceDisabledReason(caps, "hours", true)).toBeNull()
    expect(caps.resources?.performance).toEqual({ state: "available" })
    expect(
      Object.values(caps.resources ?? {}).some(
        (resource) => resource.reasonCode === "provider_capability_retired"
      )
    ).toBe(false)
    expect(
      Object.values(caps.resourceActions?.actions ?? {})
        .filter((action) => action.support === "retired")
        .every(
          (action) =>
            !action.canWrite &&
            action.reasonCode === "provider_capability_retired"
        )
    ).toBe(true)
  })

  it("keeps a publishing switch and role denial ahead of reconnect", async () => {
    env.PUBLISH_ENABLED = false
    expect(
      (await capabilities({ connected: false })).resources?.hours?.reasonCode
    ).toBe("publishing_paused")
    env.PUBLISH_ENABLED = true
    grantsFor.mockResolvedValue(
      new Map([[id, { visible: true, canPublish: false }]])
    )
    const caps = await capabilities({
      connected: false,
      session: { ...session, role: "viewer" },
    })
    expect(caps.resources?.hours?.reasonCode).toBe("publish_not_allowed")
    expect(caps.resources?.administration?.reasonCode).toBe("permission_denied")
  })

  it("keeps the billing hold ahead of reconnect and verification advice", async () => {
    const access = deriveAccess(
      {
        state: "read_only",
        trialEndsAt: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        graceEndsAt: null,
        cancelAtPeriodEnd: false,
        firstPaymentSucceeded: true,
        pendingEffectiveAt: null,
      },
      { current: { locationLimit: 3, memberLimit: null }, pending: null },
      new Date("2026-11-05T00:00:00Z")
    )
    const caps = await capabilities({
      connected: false,
      verified: false,
      session: { ...session, access, entitlementEnforced: true },
    })
    expect(caps).toMatchObject({ canPublish: false, canWrite: false })
    expect(caps.resources?.hours).toEqual({
      state: "readOnly",
      reasonCode: "billing_read_only",
    })
  })
})
