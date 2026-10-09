import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ account: vi.fn(), snapshot: vi.fn() }))
vi.mock("@/lib/server/db", () => ({
  getDatabase: () => ({}),
  withTenant: async (_id: string, callback: (sql: object) => unknown) =>
    callback({}),
}))
vi.mock("@/lib/server/env", () => ({
  gbpWritesEnabled: () => false,
  getServerEnv: () => ({}),
}))
vi.mock("@/lib/server/gbp-management", () => ({
  resolveGbpLocationContext: async () => ({
    connectionId: "con1",
    googleLocationName: "locations/l1",
    accountName: "accounts/a1",
    googleAccountId: "a1",
    canPublish: false,
  }),
  cacheGbpSnapshot: mocks.snapshot,
}))
vi.mock("@/lib/server/google", () => ({
  connectionAccessToken: async () => "synthetic-token",
  googleVerificationApi: async () => ({}),
  getGoogleUpdatedLocation: async () => ({}),
  googleAccountManagementApi: mocks.account,
}))

import { loadLocationAdministration } from "@/lib/server/location-administration"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

const session: Session = {
  sessionId: "s1",
  organisationName: "Test",
  workspaceMode: "business",
  displayName: "Test",
  email: "test@invalid.test",
  userId: "u1",
  organisationId: "o1",
  role: "owner",
  canPublish: true,
}
beforeEach(() => vi.clearAllMocks())

describe("administration subresource failures", () => {
  it.each([
    [
      new ApiError(403, "PERMISSION_DENIED", "private provider detail"),
      "permission_denied",
    ],
    [
      new ApiError(401, "google_reconnect_required", "private provider detail"),
      "reconnect_required",
    ],
    [
      new ApiError(403, "insufficient_scope", "private provider detail"),
      "reconnect_required",
    ],
    [new ApiError(404, "NOT_FOUND", "private provider detail"), "not_found"],
    [new ApiError(503, "UNAVAILABLE", "private provider detail"), "transient"],
    [new TypeError("private provider detail"), "transient"],
    [new Error("private provider detail"), "unknown"],
  ])(
    "sanitizes %s while retaining successful listing admins",
    async (error, failure) => {
      mocks.account.mockImplementation(
        async (_token: string, request: { path: string }) => {
          if (request.path === "accounts/a1/admins") throw error
          return {
            admins: [{ admin: "owner@test.invalid", role: "PRIMARY_OWNER" }],
          }
        }
      )
      const state = await loadLocationAdministration(session, "l1")
      expect(state.accountAdmins).toMatchObject({ data: null, failure })
      expect(JSON.stringify(state)).not.toContain("private provider detail")
      expect(state.locationAdmins.data).toEqual({
        admins: [{ admin: "owner@test.invalid", role: "PRIMARY_OWNER" }],
      })
    }
  )
})
