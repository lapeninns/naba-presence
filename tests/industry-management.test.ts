import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  snapshot: vi.fn(),
  mutate: vi.fn(),
  settle: vi.fn(),
}))
vi.mock("@/lib/server/db", () => ({
  getDatabase: () => ({}),
  withTenant: async (_id: string, callback: (sql: object) => unknown) =>
    callback({}),
}))
vi.mock("@/lib/server/env", () => ({
  gbpWritesEnabled: () => true,
  getServerEnv: () => ({}),
}))
vi.mock("@/lib/server/gbp-management", () => ({
  resolveGbpLocationContext: async () => ({
    connectionId: "con1",
    googleLocationName: "locations/l1",
    accountName: "accounts/a1",
    googleAccountId: "a1",
    canPublish: true,
  }),
  cacheGbpSnapshot: mocks.snapshot,
  startGbpMutation: mocks.mutate,
  settleGbpMutation: mocks.settle,
  auditGbpMutation: vi.fn(),
}))
// The real request builders and API wrappers, with only the HTTP call
// replaced: what reaches googleRequest is exactly what would hit the network.
vi.mock("@/lib/server/google/transport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/google/transport")>()),
  googleRequest: mocks.request,
}))
vi.mock("@/lib/server/google", async () => {
  const management = await import("@/lib/server/google/management")
  const transport = await import("@/lib/server/google/transport")
  return {
    connectionAccessToken: async () => "synthetic-token",
    googleHealthcareApi: management.googleHealthcareApi,
    googleLodgingApi: management.googleLodgingApi,
    GoogleMutationAmbiguousError: transport.GoogleMutationAmbiguousError,
    googleApiRetiredError: transport.googleApiRetiredError,
  }
})
vi.mock("@/lib/server/route", () => ({
  route: (config: unknown) => config,
}))

import { industryMutationSchema } from "@/lib/contracts/location-industry"
import { retiredGoogleApi } from "@/lib/domain/google-retired-apis"
import { ApiError } from "@/lib/server/http"
import { GoogleMutationAmbiguousError } from "@/lib/server/google/transport"
import {
  loadIndustryManagement,
  mutateIndustryManagement,
} from "@/lib/server/industry-management"
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

beforeEach(() => {
  vi.clearAllMocks()
  mocks.request.mockResolvedValue({ ok: true })
})

describe("industry editor load", () => {
  it("asks Google only for supported resources", async () => {
    const state = await loadIndustryManagement(session, "l1")

    const urls = mocks.request.mock.calls.map(([url]) => String(url))
    expect(urls).toHaveLength(3)
    for (const url of urls) expect(retiredGoogleApi(url)).toBeNull()
    expect(urls.map((url) => new URL(url).pathname).sort()).toEqual([
      "/v1/locations/l1/lodging",
      "/v1/locations/l1/lodging:getGoogleUpdated",
      "/v4/accounts/a1/locations/l1/serviceList",
    ])
    expect(urls.join(" ")).not.toMatch(
      /businesscalls|healthProviderAttributes|insuranceNetworks/
    )

    expect(Object.keys(state).sort()).toEqual([
      "canManage",
      "healthcareServices",
      "lodging",
      "lodgingUpdated",
      "writesEnabled",
    ])
    expect(
      mocks.snapshot.mock.calls.map(([input]) => input.resourceType)
    ).toEqual(["lodging", "healthcare_services"])
  })
})

describe("industry route retired operations", () => {
  it.each([
    ["update_business_calls", "business_calls"],
    ["update_healthcare_provider_attributes", "health_provider_attributes"],
  ])(
    "answers %s with a stable 410 and never reaches Google",
    async (operation, api) => {
      const { PATCH } =
        (await import("@/app/api/locations/[id]/industry/route")) as unknown as {
          PATCH: { handler: (input: unknown) => Promise<unknown> }
        }
      const body = industryMutationSchema.parse({
        operation,
        confirmation: "publish_industry_data_to_google",
        updateMask: ["callsState"],
        payload: { callsState: "DISABLED" },
      })
      let thrown: unknown
      try {
        await PATCH.handler({
          session,
          params: { id: "l1" },
          body,
          requestId: "r1",
        })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(ApiError)
      expect(thrown).toMatchObject({
        status: 410,
        code: "google_api_retired",
        details: { api },
      })
      expect(mocks.mutate).not.toHaveBeenCalled()
      expect(mocks.request).not.toHaveBeenCalled()
    }
  )
})

describe("industry mutation answers", () => {
  it.each([
    ["no body", null],
    ["a body that is not the resource", "<html>ok</html>"],
  ])(
    "settles a 2xx with %s as ambiguous and caches nothing",
    async (_name, answer) => {
      // Given: Google accepts the PATCH but does not return the resource.
      mocks.mutate.mockResolvedValue({ id: "m1", idempotent: false })
      mocks.request.mockResolvedValue(answer)

      // When: the lodging update is sent.
      const write = mutateIndustryManagement({
        session,
        locationId: "l1",
        operation: "update_lodging",
        payload: { property: {} },
        updateMask: ["property"],
        requestId: "r1",
      })

      // Then: it is uncertain, and no guess is cached as the live state.
      await expect(write).rejects.toBeInstanceOf(GoogleMutationAmbiguousError)
      expect(mocks.settle).toHaveBeenCalledWith(
        expect.objectContaining({ mutationId: "m1", status: "ambiguous" })
      )
      expect(mocks.snapshot).not.toHaveBeenCalled()
    }
  )
})
