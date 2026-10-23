import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  normalizeGoogleHours,
  type GoogleLocationHours,
} from "@/lib/domain/hours"
import { SERVICE_OPTIONS_WARNING } from "@/lib/editors/hours-notes"
import type { HoursObservation } from "@/lib/server/hours-observations"
import type { Session } from "@/lib/server/session"
import { mixedHoursFixture } from "./fixtures/hours-preservation"

// W3-2 / WP-11: an hours editor opened within its staleness budget is served
// from the stored observation (no Google call, one tenant transaction, no
// write); past it, on refresh, or when the stored comparison would move, it
// reads Google once and records the read.

type Observation = HoursObservation & { googlePayload: unknown }

const state = vi.hoisted(() => ({
  transactions: 0,
  resource: null as null | {
    id: string
    revision: string
    payload: unknown
    baselineCanonicalHash: string | null
    baselineGoogleHash: string | null
    lastReconciledAt: Date | null
    createdAt: Date
    updatedAt: Date
  },
  observation: null as null | Record<string, unknown>,
}))
const google = vi.hoisted(() => ({
  location: vi.fn(),
  categories: vi.fn(),
  token: vi.fn(async () => "synthetic-token"),
}))
const record = vi.hoisted(() => vi.fn())

vi.mock("@/lib/server/db", () => ({
  withTenant: async (_id: string, callback: (sql: unknown) => unknown) => {
    state.transactions += 1
    return callback(vi.fn().mockResolvedValue([]))
  },
  jsonColumn: vi.fn(),
  jsonColumnOrNull: vi.fn(),
}))
vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({}),
  gbpWritesEnabled: () => false,
}))
vi.mock("@/lib/server/gbp-write", () => ({
  attemptStore: () => ({}),
  loadLinkedLocation: async () => ({
    locationId: "l1",
    locationName: "Test",
    googleLocationName: "locations/l1",
    googleConnectionId: "c1",
    timezone: "Europe/London",
    canPublish: true,
    accessToken: google.token,
  }),
}))
vi.mock("@/lib/server/canonical-resources", () => ({
  ensureCanonicalResource: async ({
    initialPayload,
  }: {
    initialPayload: unknown
  }) => {
    state.resource ??= {
      id: "r1",
      revision: "1",
      payload: initialPayload,
      baselineCanonicalHash: null,
      baselineGoogleHash: null,
      lastReconciledAt: null,
      createdAt: new Date("2026-10-01T00:00:00Z"),
      updatedAt: new Date("2026-10-01T00:00:00Z"),
    }
    return state.resource
  },
  readCanonicalResource: async () => state.resource,
}))
vi.mock("@/lib/server/hours-observations", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/hours-observations")>()
  return {
    ...actual,
    readHoursObservation: async () => state.observation,
    recordHoursObservation: record,
  }
})
vi.mock("@/lib/server/google", () => ({
  getGoogleLocation: google.location,
  getGoogleHoursCategories: google.categories,
}))

const { getHoursState } = await import("@/lib/server/hours")
const { nextComparisonParts } = await vi.importActual<
  typeof import("@/lib/server/hours-observations")
>("@/lib/server/hours-observations")

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

const googleLocation: GoogleLocationHours = {
  ...structuredClone(mixedHoursFixture),
  name: "locations/l1",
  categories: { primaryCategory: { name: "gcid:pub" } },
}

const googleCalls = () =>
  google.location.mock.calls.length + google.categories.mock.calls.length

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-14T12:00:00Z"), toFake: ["Date"] })
  vi.clearAllMocks()
  state.transactions = 0
  state.resource = null
  state.observation = null
  google.location.mockImplementation(async () =>
    structuredClone(googleLocation)
  )
  google.categories.mockResolvedValue([
    {
      name: "gcid:pub",
      moreHoursTypes: [{ hoursTypeId: "KITCHEN", displayName: "Kitchen" }],
    },
  ])
  // What recordHoursObservation stores, for a successful read: the
  // comparison follows the real baseline rules, the payload is kept.
  record.mockImplementation(
    async (_sql: unknown, input: Record<string, never>) => {
      const previous = state.observation as Observation | null
      if (input.outcome === "failed") {
        state.observation = {
          ...previous,
          attemptedAt: input.attemptedAt,
          errorCode: input.errorCode,
        }
        return state.observation
      }
      const matches = !input.blocked && input.canonicalHash === input.googleHash
      state.observation = {
        locationId: "l1",
        googleHash: input.googleHash,
        comparisonCanonicalHash: matches
          ? input.canonicalHash
          : (previous?.comparisonCanonicalHash ?? input.baselineCanonicalHash),
        comparisonGoogleHash: matches
          ? input.googleHash
          : (previous?.comparisonGoogleHash ?? input.baselineGoogleHash),
        observedAt: input.attemptedAt,
        attemptedAt: input.attemptedAt,
        errorCode: null,
        blocked: input.blocked,
        observedGoogleParts: input.googleParts,
        comparisonParts:
          nextComparisonParts({
            previous: previous?.comparisonParts ?? null,
            canonicalParts: input.canonicalParts,
            googleParts: input.googleParts,
            blocked: input.blocked,
          }) ??
          previous?.comparisonParts ??
          null,
        googlePayload: input.googlePayload ?? previous?.googlePayload ?? null,
      }
      return state.observation
    }
  )
})
afterEach(() => {
  vi.useRealTimers()
})

function resetCounters() {
  vi.clearAllMocks()
  state.transactions = 0
}

describe("hours editor freshness", () => {
  it("reads Google on the first open and records what it read", async () => {
    const hours = await getHoursState(session, "l1")
    expect(hours.source).toBe("live")
    expect(hours.observedAt).toBe("2026-10-14T12:00:00.000Z")
    expect(google.location).toHaveBeenCalledOnce()
    expect(google.categories).toHaveBeenCalledOnce()
    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        outcome: "observed",
        googlePayload: expect.objectContaining({
          observedAt: "2026-10-14T12:00:00.000Z",
          metadataWarnings: [],
        }),
      })
    )
  })

  it("serves an open within the budget from storage: no Google call, one transaction, no write, the same state", async () => {
    const live = await getHoursState(session, "l1")
    resetCounters()
    vi.setSystemTime(new Date("2026-10-14T12:04:00Z"))

    const stored = await getHoursState(session, "l1")

    expect(googleCalls()).toBe(0)
    expect(google.token).not.toHaveBeenCalled()
    expect(state.transactions).toBeLessThanOrEqual(2)
    expect(state.transactions).toBe(1)
    expect(record).not.toHaveBeenCalled()
    expect(stored.source).toBe("stored")
    expect(stored.observedAt).toBe(live.observedAt)
    expect({ ...stored, source: "live" }).toEqual(live)
  })

  it("reads Google once when the observation is past the budget", async () => {
    await getHoursState(session, "l1")
    resetCounters()
    vi.setSystemTime(new Date("2026-10-14T12:05:01Z"))

    const hours = await getHoursState(session, "l1")

    expect(hours.source).toBe("live")
    expect(google.location).toHaveBeenCalledOnce()
    expect(record).toHaveBeenCalledOnce()
    // The stored attempt's location is reused: no more transactions than a
    // live read always took (location, canonical, observation, attempt).
    expect(state.transactions).toBe(4)
  })

  it("reads Google on an explicit refresh within the budget", async () => {
    await getHoursState(session, "l1")
    resetCounters()

    const hours = await getHoursState(session, "l1", { refresh: true })

    expect(hours.source).toBe("live")
    expect(google.location).toHaveBeenCalledOnce()
  })

  it("serves a local edit from storage, classified as a live read would", async () => {
    await getHoursState(session, "l1")
    const google = normalizeGoogleHours(googleLocation)
    state.resource = {
      ...state.resource!,
      revision: "2",
      payload: {
        ...google,
        special: [],
      },
    }
    resetCounters()

    const stored = await getHoursState(session, "l1")
    expect(stored.source).toBe("stored")
    expect(stored.status).toBe("core_dirty")
    expect(googleCalls()).toBe(0)

    const live = await getHoursState(session, "l1", { refresh: true })
    expect(live.status).toBe(stored.status)
    expect(live.partStatus).toEqual(stored.partStatus)
  })

  it("reads Google when recording the comparison would move a baseline", async () => {
    // Google and the saved schedule differ at first; a save then brings
    // them in line, which only a recorded (live) read may establish.
    state.resource = {
      id: "r1",
      revision: "1",
      payload: { regular: [], special: [], moreHours: [] },
      baselineCanonicalHash: null,
      baselineGoogleHash: null,
      lastReconciledAt: null,
      createdAt: new Date("2026-10-01T00:00:00Z"),
      updatedAt: new Date("2026-10-01T00:00:00Z"),
    }
    await getHoursState(session, "l1")
    state.resource = {
      ...state.resource,
      revision: "2",
      payload: normalizeGoogleHours(googleLocation),
    }
    resetCounters()

    const hours = await getHoursState(session, "l1")

    expect(hours.source).toBe("live")
    expect(hours.status).toBe("in_sync")
    expect(record).toHaveBeenCalledOnce()
  })

  it("reads Google when a later writer moved Google's hash past the stored payload", async () => {
    await getHoursState(session, "l1")
    state.observation = { ...state.observation, googleHash: "f".repeat(64) }
    resetCounters()

    expect((await getHoursState(session, "l1")).source).toBe("live")
    expect(google.location).toHaveBeenCalledOnce()
  })

  it("reads Google when the last read failed or carried a metadata warning", async () => {
    await getHoursState(session, "l1")
    state.observation = {
      ...state.observation,
      errorCode: "google_unavailable",
    }
    resetCounters()
    expect((await getHoursState(session, "l1")).source).toBe("live")

    google.categories.mockRejectedValue(new TypeError("fetch failed"))
    await getHoursState(session, "l1", { refresh: true })
    resetCounters()
    google.categories.mockResolvedValue([])
    expect((await getHoursState(session, "l1")).source).toBe("live")
    expect(google.categories).toHaveBeenCalledOnce()
  })

  it("reads Google when nothing is stored yet", async () => {
    state.resource = null
    state.observation = null
    expect((await getHoursState(session, "l1")).source).toBe("live")
    expect(google.location).toHaveBeenCalledOnce()
  })
})

// From the former hours-metadata-recovery.test.ts.
describe("optional hours metadata transport failures", () => {
  it.each([
    new TypeError("fetch failed"),
    new DOMException("request aborted", "AbortError"),
    new DOMException("request timed out", "TimeoutError"),
  ])(
    "preserves hours and records the successful read after %s",
    async (error) => {
      google.categories.mockRejectedValue(error)
      const state = await getHoursState(session, "l1")
      expect(state.google.moreHours).toEqual(
        normalizeGoogleHours(googleLocation).moreHours
      )
      expect(state.google.moreHours.length).toBeGreaterThan(0)
      expect(state.supportedHoursTypes).toEqual([])
      expect(state.warnings).toContainEqual(SERVICE_OPTIONS_WARNING)
      expect(record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ outcome: "observed" })
      )
    }
  )
})
