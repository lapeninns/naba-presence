import { describe, expect, it } from "vitest"
import { googleResourceActionsSchema } from "@/lib/contracts/google-resource-actions"
import { resourceActionCapabilities } from "@/lib/domain/google-resource-catalogue"
import { RETIRED_GOOGLE_CAPABILITIES } from "@/lib/domain/google-support"

const input = { connected: true, canRead: true, canPublish: true, managerial: true,
  writesEnabled: { profileWrites: true, media: true, posts: true, foodMenus: true, placeActions: true, performance: true } }
const observedAt = "2026-09-30T08:00:00.000Z"

describe("Google resource/action capability observations", () => {
  it("keeps documented support separate from unknown listing eligibility", () => {
    const catalogue = resourceActionCapabilities(input)
    expect(googleResourceActionsSchema.safeParse(catalogue).success).toBe(true)
    expect(catalogue.actions["posts.create"]).toMatchObject({ support: "supported", eligibility: "unknown", canWrite: false, reasonCode: "eligibility_unknown", observedAt: null })
    expect(catalogue.actions["posts.list"]).toMatchObject({ canRead: true, eligibility: "unknown", canWrite: false })
  })

  it.each([true, false, null])("preserves an explicit eligibility observation %s", (eligible) => {
    const action = resourceActionCapabilities({ ...input, observations: { "posts.create": { eligible, observedAt } } }).actions["posts.create"]
    expect(action).toMatchObject({ eligibility: eligible === true ? "eligible" : eligible === false ? "ineligible" : "unknown", canWrite: eligible === true, observedAt })
    expect(action?.reasonCode).toBe(eligible === true ? undefined : eligible === false ? "location_ineligible" : "eligibility_unknown")
  })

  it.each([
    [{ connected: false }, "reconnect_required"],
    [{ canPublish: false }, "permission_denied"],
    [{ canRead: false }, "permission_denied"],
    [{ writesEnabled: { ...input.writesEnabled, posts: false } }, "publishing_paused"],
  ] as const)("local gate %j blocks an eligible provider write", (override, reasonCode) => {
    expect(resourceActionCapabilities({ ...input, ...override, observations: { "posts.create": { eligible: true, observedAt } } }).actions["posts.create"])
      .toMatchObject({ eligibility: "eligible", canWrite: false, reasonCode })
  })

  it("keeps account/location access actions hidden from non-managers", () => {
    const actions = resourceActionCapabilities({ ...input, managerial: false }).actions
    expect(actions["accountAdmins.list"]).toMatchObject({ canRead: false, reasonCode: "permission_denied" })
    expect(actions["verificationRequests.complete"]).toMatchObject({ canWrite: false, reasonCode: "permission_denied" })
  })

  it("retains every retired method, including duplicate action names, with no active operation", () => {
    const actions = Object.values(resourceActionCapabilities(input).actions).filter((action) => action.support === "retired")
    const methods = Object.values(RETIRED_GOOGLE_CAPABILITIES).flatMap((definition) => [...definition.methods])
    expect(actions.map((action) => action.providerMethod).sort()).toEqual([...methods].sort())
    for (const action of actions) expect(action).toMatchObject({ canRead: false, canWrite: false, reasonCode: "provider_capability_retired" })
  })

  it("preserves read-only customer media, current performance and the retail Google handoff", () => {
    const actions = resourceActionCapabilities(input).actions
    expect(actions["customerMedia.list"]).toMatchObject({ support: "read_only", canRead: true, canWrite: false })
    expect(actions["performance.fetchMultiDailyMetricsTimeSeries"]).toMatchObject({ support: "read_only", canRead: true, providerMethod: "locations.fetchMultiDailyMetricsTimeSeries" })
    expect(actions["retailProducts.manage"]).toMatchObject({ support: "external", providerMethod: null, canWrite: false, reasonCode: "managed_in_google", handoffUrl: "https://business.google.com/" })
  })
})
