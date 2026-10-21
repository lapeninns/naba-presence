import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Session } from "@/lib/server/session"

// W3-2 (WP-11): the business-information GET fans out across three Google
// APIs (location, attributes, attribute metadata). Within the editors'
// staleness budget it is served from its last read: no Google call, one
// read-only transaction. Reviews and publishes still read Google, and a
// review that finds Google moved drops the stored read so the refresh it
// asks for reads Google.

const state = vi.hoisted(() => ({
  transactions: 0,
  writes: 0,
  observation: null as null | { payload: unknown; failed: boolean },
}))
const google = vi.hoisted(() => ({
  location: vi.fn(),
  attributes: vi.fn(),
  metadata: vi.fn(),
  token: vi.fn(async () => "synthetic-token"),
}))
const observations = vi.hoisted(() => ({ record: vi.fn(), forget: vi.fn() }))
const snapshots = vi.hoisted(() => ({ cache: vi.fn(async () => "hash") }))

vi.mock("@/lib/server/db", () => ({
  withTenant: async (_id: string, callback: (sql: unknown) => unknown) => {
    state.transactions += 1
    return callback(
      vi.fn(async (strings: TemplateStringsArray) => {
        if (/\b(insert|update|delete)\b/i.test(strings.join("?")))
          state.writes += 1
        return []
      })
    )
  },
  getDatabase: () => ({}),
  jsonColumn: (_sql: unknown, value: unknown) => value,
  jsonColumnOrNull: (_sql: unknown, value: unknown) => value,
}))
vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({}),
  gbpWritesEnabled: () => true,
}))
vi.mock("@/lib/server/gbp-management", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/gbp-management")>()),
  cacheGbpSnapshot: snapshots.cache,
  resolveGbpLocationContext: async () => ({
    locationId: "l1",
    googleLocationName: "locations/l1",
    connectionId: "c1",
    googleConnectionId: "c1",
    googleAccountId: "a1",
    canPublish: true,
    accessToken: google.token,
  }),
}))
vi.mock("@/lib/server/resource-observations", () => ({
  readObservedGooglePayload: async () => state.observation,
  recordResourceObservation: observations.record,
  forgetObservedGooglePayload: observations.forget,
}))
vi.mock("@/lib/server/google", () => ({
  connectionAccessToken: google.token,
  getGoogleLocation: google.location,
  getGoogleLocationAttributes: google.attributes,
  listGoogleCategories: vi.fn(),
  patchGoogleLocation: vi.fn(),
  patchGoogleLocationAttributes: vi.fn(),
  searchGoogleChains: vi.fn(),
}))
vi.mock("@/lib/server/attribute-metadata", () => ({
  loadGoogleAttributeMetadata: google.metadata,
}))

const { loadBusinessInformation, previewBusinessInformation } =
  await import("@/lib/server/business-information")

const session: Session = {
  sessionId: "s1",
  userId: "u1",
  organisationId: "o1",
  organisationName: "Test",
  workspaceMode: "business",
  displayName: "Owner",
  email: "owner@invalid.test",
  role: "owner",
  canPublish: true,
}

const location = {
  name: "locations/l1",
  title: "Camden Hotel",
  websiteUri: "https://camden.invalid/",
  metadata: {},
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-14T12:00:00Z"), toFake: ["Date"] })
  vi.clearAllMocks()
  state.transactions = 0
  state.writes = 0
  state.observation = null
  google.location.mockImplementation(async () => structuredClone(location))
  google.attributes.mockResolvedValue({
    name: "locations/l1/attributes",
    attributes: [],
  })
  google.metadata.mockResolvedValue([])
  observations.record.mockImplementation(
    async (_sql: unknown, input: { googlePayload?: unknown }) => {
      state.observation = {
        payload: input.googlePayload ?? null,
        failed: false,
      }
    }
  )
})
afterEach(() => {
  vi.useRealTimers()
})

function resetCounters() {
  vi.clearAllMocks()
  state.transactions = 0
  state.writes = 0
}

describe("business information freshness", () => {
  it("reads the three Google APIs on the first open and records the observation", async () => {
    const live = await loadBusinessInformation(session, "l1")
    expect(live.source).toBe("live")
    expect(live.observedAt).toBe("2026-10-14T12:00:00.000Z")
    expect(google.location).toHaveBeenCalledOnce()
    expect(google.attributes).toHaveBeenCalledOnce()
    expect(google.metadata).toHaveBeenCalledOnce()
    expect(observations.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resource: "businessInformation" })
    )
  })

  it("serves an open within the budget: no Google call, one transaction, no write, the same state", async () => {
    const live = await loadBusinessInformation(session, "l1")
    resetCounters()
    vi.setSystemTime(new Date("2026-10-14T12:04:59Z"))

    const stored = await loadBusinessInformation(session, "l1")

    expect(google.location).not.toHaveBeenCalled()
    expect(google.attributes).not.toHaveBeenCalled()
    expect(google.metadata).not.toHaveBeenCalled()
    expect(google.token).not.toHaveBeenCalled()
    expect(snapshots.cache).not.toHaveBeenCalled()
    expect(observations.record).not.toHaveBeenCalled()
    expect(state.transactions).toBe(1)
    expect(state.writes).toBe(0)
    expect({ ...stored, source: "live" }).toEqual(live)
  })

  it("reads Google once when stale, on refresh, after a failure, a dropped read or a relink", async () => {
    await loadBusinessInformation(session, "l1")
    const payload = state.observation!.payload as Record<string, unknown>
    resetCounters()
    expect(
      (await loadBusinessInformation(session, "l1", { refresh: true })).source
    ).toBe("live")
    expect(google.location).toHaveBeenCalledOnce()

    const cases: Array<() => void> = [
      () => vi.setSystemTime(new Date("2026-10-14T12:10:01Z")),
      () => (state.observation = { payload, failed: true }),
      () => (state.observation = { payload: null, failed: false }),
      () =>
        (state.observation = {
          payload: { ...payload, googleLocationName: "locations/other" },
          failed: false,
        }),
    ]
    for (const arrange of cases) {
      vi.setSystemTime(new Date("2026-10-14T12:06:00Z"))
      state.observation = {
        payload: { ...payload, observedAt: "2026-10-14T12:05:00.000Z" },
        failed: false,
      }
      arrange()
      resetCounters()
      expect((await loadBusinessInformation(session, "l1")).source).toBe("live")
      expect(google.location).toHaveBeenCalledOnce()
    }
  })

  it("a review that finds Google moved drops the stored read, so the refresh reads Google", async () => {
    const shown = await loadBusinessInformation(session, "l1")
    google.location.mockResolvedValue({
      ...location,
      title: "Changed at Google",
    })
    resetCounters()
    await expect(
      previewBusinessInformation({
        session,
        locationId: "l1",
        payload: { title: "Camden House" },
        updateMask: ["title"],
        expectedGoogleHash: shown.locationHash,
        requestId: "r1",
      })
    ).rejects.toMatchObject({ code: "business_information_stale" })
    expect(observations.forget).toHaveBeenCalledWith({
      organisationId: "o1",
      locationId: "l1",
      resources: ["businessInformation"],
    })
  })
})
