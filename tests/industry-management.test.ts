import { beforeEach, describe, expect, it, vi } from "vitest"

import type { memoryAttemptStore } from "./helpers/memory-attempt-store"

type Statement = { text: string; values: unknown[] }

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  statements: [] as Statement[],
  snapshotRows: [] as Array<{ payload: unknown; googleHash: string }>,
  failSnapshotWrite: false,
  memory: null as unknown as ReturnType<typeof memoryAttemptStore>,
}))

// A tagged-template stand-in for the tenant transaction: it records every
// statement, answers the snapshot lookup from `snapshotRows`, and can be made
// to fail the snapshot write.
function fakeSql(strings: TemplateStringsArray, ...values: unknown[]) {
  const text = strings.join("?")
  mocks.statements.push({ text, values })
  if (
    mocks.failSnapshotWrite &&
    text.includes("insert into gbp_resource_snapshot")
  ) {
    return Promise.reject(new Error("snapshot write failed"))
  }
  if (text.includes("from gbp_resource_snapshot")) {
    return Promise.resolve(mocks.snapshotRows)
  }
  return Promise.resolve([])
}

vi.mock("@/lib/server/db", () => ({
  getDatabase: () => ({}),
  jsonColumn: (_sql: unknown, value: unknown) => value,
  jsonColumnOrNull: (_sql: unknown, value: unknown) => value ?? null,
  withTenant: async (_id: string, callback: (sql: unknown) => unknown) =>
    callback(fakeSql),
}))
vi.mock("@/lib/server/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("@/lib/server/env", () => ({
  gbpWritesEnabled: () => true,
  getServerEnv: () => ({}),
}))
vi.mock("@/lib/server/gbp-management", async (importOriginal) => {
  const { memoryAttemptStore } = await import("./helpers/memory-attempt-store")
  mocks.memory = memoryAttemptStore()
  return {
    ...(await importOriginal<typeof import("@/lib/server/gbp-management")>()),
    resolveGbpLocationContext: async () => ({
      connectionId: "con1",
      googleLocationName: "locations/l1",
      accountName: "accounts/a1",
      googleAccountId: "a1",
      canPublish: true,
    }),
    gbpManagementAttemptStore: mocks.memory.store,
  }
})
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
import { stableGoogleHash } from "@/lib/server/gbp-management"
import { ApiError } from "@/lib/server/http"
import { GoogleMutationAmbiguousError } from "@/lib/server/google/transport"
import {
  industryResourceName,
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

const LODGING = {
  name: "locations/l1/lodging",
  pets: { petsAllowed: false },
  pools: { pool: true },
}

/** Google answering GETs with `read()` and PATCHes with `patch()`. */
function google(input: { read?: () => unknown; patch?: () => unknown }) {
  mocks.request.mockImplementation(
    async (_url: string, _token: string, init: RequestInit) =>
      init?.method === "PATCH"
        ? (input.patch ?? (() => ({ ok: true })))()
        : (input.read ?? (() => LODGING))()
  )
}

function patchCalls() {
  return mocks.request.mock.calls.filter(
    ([, , init]) => (init as RequestInit | undefined)?.method === "PATCH"
  )
}

function snapshotWrites() {
  return mocks.statements
    .filter((statement) =>
      statement.text.includes("insert into gbp_resource_snapshot")
    )
    .map((statement) => ({
      resourceType: statement.values[3],
      resourceName: statement.values[4],
      payload: statement.values[5],
    }))
}

function lodgingUpdate(
  overrides: Partial<Parameters<typeof mutateIndustryManagement>[0]> = {}
) {
  return mutateIndustryManagement({
    session,
    locationId: "l1",
    operation: "update_lodging",
    payload: { pets: { petsAllowed: true } },
    updateMask: ["pets"],
    expectedGoogleHash: stableGoogleHash(LODGING),
    requestId: "r1",
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.statements.length = 0
  mocks.snapshotRows = []
  mocks.failSnapshotWrite = false
  mocks.memory.reset()
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
      "lodgingHash",
      "lodgingUpdated",
      "writesEnabled",
    ])
    expect(state.lodgingHash).toBe(stableGoogleHash({ ok: true }))
    expect(snapshotWrites().map((write) => write.resourceType)).toEqual([
      "lodging",
      "healthcare_services",
    ])
  })

  it("caches each resource under the name its write refreshes", async () => {
    await loadIndustryManagement(session, "l1")
    const linked = {
      accountName: "accounts/a1",
      googleLocationName: "locations/l1",
    }
    expect(snapshotWrites().map((write) => write.resourceName)).toEqual([
      industryResourceName("lodging", linked),
      industryResourceName("healthcare_services", linked),
    ])
    expect(industryResourceName("healthcare_services", linked)).toBe(
      "accounts/a1/locations/l1/serviceList"
    )
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
      expect(mocks.memory.rows.size).toBe(0)
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
      google({ patch: () => answer })

      // When: the lodging update is sent.
      const write = lodgingUpdate()

      // Then: it is uncertain, and no guess is cached as the live state.
      await expect(write).rejects.toBeInstanceOf(GoogleMutationAmbiguousError)
      expect(mocks.memory.only().status).toBe("ambiguous")
      expect(snapshotWrites()).toEqual([])
    }
  )

  it("settles succeeded only when the readback confirms the mask, and caches the readback", async () => {
    // Given: Google applies the PATCH, and the readback carries the new
    // value plus fields Google adds.
    let live: Record<string, unknown> = LODGING
    google({
      read: () => live,
      patch: () => {
        live = {
          ...LODGING,
          pets: { petsAllowed: true, petsAllowedException: "UNSPECIFIED" },
        }
        return live
      },
    })

    // When: the update is sent.
    const result = await lodgingUpdate()

    // Then: the row settled succeeded on the readback, which is cached.
    expect(result).toMatchObject({ status: "succeeded", idempotent: false })
    expect(mocks.memory.only()).toMatchObject({
      status: "succeeded",
      response: live,
      responseHash: stableGoogleHash(live),
    })
    expect(snapshotWrites()).toEqual([
      {
        resourceType: "lodging",
        resourceName: "locations/l1/lodging",
        payload: live,
      },
    ])
  })

  it("settles failed on a readback that does not match", async () => {
    // Given: Google answers the PATCH but the readback still holds the old
    // value (false, not unset).
    google({ patch: () => ({ ...LODGING }) })

    // When / Then: the write is a definite failure, nothing is cached.
    await expect(lodgingUpdate()).rejects.toMatchObject({
      status: 502,
      code: "industry_readback_mismatch",
    })
    expect(mocks.memory.only()).toMatchObject({
      status: "failed",
      errorCode: "industry_readback_mismatch",
    })
    expect(snapshotWrites()).toEqual([])
  })

  it("settles ambiguous when the readback cannot be read", async () => {
    let reads = 0
    google({
      read: () => {
        reads += 1
        // The first read is the staleness check; the second is the readback.
        if (reads > 1) throw new ApiError(503, "google_unavailable", "down")
        return LODGING
      },
      patch: () => ({ ...LODGING, pets: { petsAllowed: true } }),
    })

    await expect(lodgingUpdate()).rejects.toMatchObject({
      code: "google_unavailable",
    })
    expect(mocks.memory.only().status).toBe("ambiguous")
  })

  it("keeps a landed write succeeded when the snapshot cache fails after it", async () => {
    // Given: the write lands and reads back, but caching the snapshot fails.
    let live: Record<string, unknown> = LODGING
    google({
      read: () => live,
      patch: () => {
        live = { ...LODGING, pets: { petsAllowed: true } }
        return live
      },
    })
    mocks.failSnapshotWrite = true

    // When / Then: the write still answers succeeded and the row says so.
    await expect(lodgingUpdate()).resolves.toMatchObject({
      status: "succeeded",
    })
    expect(mocks.memory.only().status).toBe("succeeded")
  })

  it("refuses a lodging write whose masked group changed on Google", async () => {
    // Given: Google's pets group changed since the editor loaded it, and the
    // load-time snapshot is the one the editor's hash names.
    const loaded = { ...LODGING, pets: { petsAllowed: true } }
    mocks.snapshotRows = [
      { payload: loaded, googleHash: stableGoogleHash(loaded) },
    ]
    google({})

    // When / Then: 409 stale, and nothing is recorded or sent.
    await expect(
      lodgingUpdate({ expectedGoogleHash: stableGoogleHash(loaded) })
    ).rejects.toMatchObject({ status: 409, code: "lodging_stale" })
    expect(patchCalls()).toHaveLength(0)
    expect(mocks.memory.rows.size).toBe(0)
  })

  it("lets a lodging write through when only an unmasked group changed", async () => {
    // Given: only `pools` changed on Google since the load.
    const loaded = { ...LODGING, pools: { pool: false } }
    mocks.snapshotRows = [
      { payload: loaded, googleHash: stableGoogleHash(loaded) },
    ]
    let live: Record<string, unknown> = LODGING
    google({
      read: () => live,
      patch: () => {
        live = { ...LODGING, pets: { petsAllowed: true } }
        return live
      },
    })

    // When / Then: the pets write is not stale.
    await expect(
      lodgingUpdate({ expectedGoogleHash: stableGoogleHash(loaded) })
    ).resolves.toMatchObject({ status: "succeeded" })
    expect(patchCalls()).toHaveLength(1)
  })

  it("reads healthcare back from the serviceList it patched", async () => {
    let live: Record<string, unknown> = { services: [] }
    google({
      read: () => live,
      patch: () => {
        live = {
          name: "accounts/a1/locations/l1/serviceList",
          services: [{ id: "s" }],
        }
        return live
      },
    })

    await expect(
      mutateIndustryManagement({
        session,
        locationId: "l1",
        operation: "update_healthcare_services",
        payload: { services: [{ id: "s" }] },
        updateMask: ["services"],
        requestId: "r1",
      })
    ).resolves.toMatchObject({ status: "succeeded" })
    expect(snapshotWrites()).toEqual([
      {
        resourceType: "healthcare_services",
        resourceName: "accounts/a1/locations/l1/serviceList",
        payload: live,
      },
    ])
  })
})
