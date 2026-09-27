import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "@/lib/server/session"
import type { NormalizedHours } from "@/lib/domain/hours"

const mocks = vi.hoisted(() => ({ categories: vi.fn(), observation: vi.fn() }))
vi.mock("@/lib/server/db", () => ({
  withTenant: async (_id: string, callback: (sql: ReturnType<typeof vi.fn>) => unknown) => callback(vi.fn().mockResolvedValue([])),
  jsonColumn: vi.fn(),
}))
vi.mock("@/lib/server/env", () => ({ getServerEnv: () => ({}), gbpWritesEnabled: () => false }))
vi.mock("@/lib/server/gbp-write", () => ({
  attemptStore: () => ({}),
  loadLinkedLocation: async () => ({ locationId: "l1", locationName: "Test", googleLocationName: "locations/l1", googleConnectionId: "c1", timezone: "Europe/London", canPublish: true, accessToken: async () => "synthetic-token" }),
}))
vi.mock("@/lib/server/canonical-resources", () => ({
  ensureCanonicalResource: async ({ initialPayload }: { initialPayload: NormalizedHours }) => ({ payload: initialPayload, revision: "1", updatedAt: new Date(), baselineCanonicalHash: null, baselineGoogleHash: null }),
}))
vi.mock("@/lib/server/hours-observations", () => ({ recordHoursObservation: mocks.observation }))
vi.mock("@/lib/server/google", () => ({
  getGoogleLocation: async () => ({ categories: { primaryCategory: { name: "gcid:test" } }, moreHours: [{ hoursTypeId: "EXISTING_SERVICE", periods: [] }] }),
  getGoogleHoursCategories: mocks.categories,
}))

import { getHoursState } from "@/lib/server/hours"

const session: Session = { sessionId: "s1", userId: "u1", organisationId: "o1", organisationName: "Test", displayName: "Owner", email: "owner@invalid.test", role: "owner", canPublish: true }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.observation.mockResolvedValue({ comparisonCanonicalHash: null, comparisonGoogleHash: null })
})
describe("optional hours metadata transport failures", () => {
  it.each([new TypeError("fetch failed"), new DOMException("request aborted", "AbortError"), new DOMException("request timed out", "TimeoutError")])("preserves hours and records the successful read after %s", async (error) => {
    mocks.categories.mockRejectedValue(error)
    const state = await getHoursState(session, "l1")
    expect(state.google.moreHours).toEqual([{ hoursTypeId: "EXISTING_SERVICE", periods: [] }])
    expect(state.supportedHoursTypes).toEqual([])
    expect(state.warnings).toContainEqual(expect.stringContaining("metadata could not be loaded"))
    expect(mocks.observation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ outcome: "observed" }))
  })
})
