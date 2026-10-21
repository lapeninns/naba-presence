import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { GoogleLocationProfile } from "@/lib/domain/profile"
import type { Session } from "@/lib/server/session"

// W0-04 / W3-2 (WP-11): a profile editor opened within its staleness budget
// is served from the stored observation in one read-only transaction with no
// Google call; a live read records what it observed in one transaction; a
// save never reads Google.

type FieldRow = {
  fieldKey: string
  googleHash: string | null
  baselineCanonicalHash: string | null
  baselineGoogleHash: string | null
  lastReconciledAt: Date | null
}

const state = vi.hoisted(() => ({
  transactions: 0,
  writes: 0,
  fields: new Map<string, FieldRow>(),
  resource: null as null | Record<string, unknown>,
  observation: null as null | { payload: unknown; failed: boolean },
}))
const google = vi.hoisted(() => ({
  location: vi.fn(),
  token: vi.fn(async () => "synthetic-token"),
}))
const observations = vi.hoisted(() => ({
  record: vi.fn(),
  forget: vi.fn(),
}))

function sqlFor() {
  return vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?")
    if (text.includes("insert into profile_field_state")) {
      state.writes += 1
      const key = values[3] as string
      const previous = state.fields.get(key)
      state.fields.set(key, {
        fieldKey: key,
        googleHash: values[9] as string,
        baselineCanonicalHash:
          previous?.baselineCanonicalHash ?? (values[10] as string | null),
        baselineGoogleHash:
          previous?.baselineGoogleHash ?? (values[11] as string | null),
        lastReconciledAt: previous?.lastReconciledAt ?? null,
      })
      return []
    }
    if (text.includes("from profile_field_state"))
      return [...state.fields.values()]
    if (/\b(insert|update|delete)\b/i.test(text)) state.writes += 1
    return []
  })
}

vi.mock("@/lib/server/db", () => ({
  withTenant: async (_id: string, callback: (sql: unknown) => unknown) => {
    state.transactions += 1
    return callback(sqlFor())
  },
  jsonColumn: (_sql: unknown, value: unknown) => value,
  jsonColumnOrNull: (_sql: unknown, value: unknown) => value,
}))
vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({}),
  gbpWritesEnabled: () => false,
}))
vi.mock("@/lib/server/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("@/lib/server/gbp-write", () => ({
  attemptStore: () => ({}),
  loadLinkedLocation: async () => ({
    locationId: "l1",
    locationName: "Camden Hotel",
    externalLocationId: "e1",
    googleLocationName: "locations/l1",
    googleConnectionId: "c1",
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
  updateCanonicalResource: async ({ payload }: { payload: unknown }) => {
    state.writes += 1
    state.resource = {
      ...state.resource,
      payload,
      revision: String(Number(state.resource?.revision) + 1),
    }
    return state.resource
  },
}))
vi.mock("@/lib/server/resource-observations", () => ({
  readObservedGooglePayload: async () => state.observation,
  recordResourceObservation: observations.record,
  forgetObservedGooglePayload: observations.forget,
}))
vi.mock("@/lib/server/google", () => ({
  getGoogleLocation: google.location,
  patchGoogleLocationProfile: vi.fn(),
}))

const { getProfileState, saveCanonicalProfile } =
  await import("@/lib/server/profile")

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

const googleLocation: GoogleLocationProfile = {
  name: "locations/l1",
  title: "Camden Hotel",
  phoneNumbers: { primaryPhone: "+44 20 7946 0000" },
  profile: { description: "A calm stay" },
  websiteUri: "https://camden.invalid/",
  categories: {
    primaryCategory: { name: "gcid:hotel", displayName: "Hotel" },
  },
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-14T12:00:00Z"), toFake: ["Date"] })
  vi.clearAllMocks()
  state.transactions = 0
  state.writes = 0
  state.fields = new Map()
  state.resource = null
  state.observation = null
  google.location.mockImplementation(async () =>
    structuredClone(googleLocation)
  )
  observations.record.mockImplementation(
    async (_sql: unknown, input: { googlePayload?: unknown }) => {
      state.writes += 1
      state.observation = {
        payload: input.googlePayload ?? state.observation?.payload ?? null,
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

describe("profile editor freshness", () => {
  it("reads Google on the first open and records it, fields and observation, in one transaction", async () => {
    const profile = await getProfileState(session, "l1")
    expect(profile.source).toBe("live")
    expect(google.location).toHaveBeenCalledOnce()
    expect(observations.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        resource: "profile",
        googlePayload: expect.objectContaining({
          observedAt: "2026-10-14T12:00:00.000Z",
        }),
      })
    )
    // The stored attempt, the canonical row, and one write transaction.
    expect(state.transactions).toBe(3)
  })

  it("serves an open within the budget from storage: no Google call, one transaction, no write, the same state", async () => {
    const live = await getProfileState(session, "l1")
    resetCounters()
    vi.setSystemTime(new Date("2026-10-14T12:04:00Z"))

    const stored = await getProfileState(session, "l1")

    expect(google.location).not.toHaveBeenCalled()
    expect(google.token).not.toHaveBeenCalled()
    expect(state.transactions).toBe(1)
    expect(state.writes).toBe(0)
    expect(observations.record).not.toHaveBeenCalled()
    expect(stored.source).toBe("stored")
    expect({ ...stored, source: "live" }).toEqual(live)
  })

  it("reads Google once when stale or on refresh", async () => {
    await getProfileState(session, "l1")
    resetCounters()
    expect(
      (await getProfileState(session, "l1", { refresh: true })).source
    ).toBe("live")
    expect(google.location).toHaveBeenCalledOnce()

    resetCounters()
    vi.setSystemTime(new Date("2026-10-14T12:05:01Z"))
    expect((await getProfileState(session, "l1")).source).toBe("live")
    expect(google.location).toHaveBeenCalledOnce()
  })

  it("reads Google when another writer dropped the payload or moved a field's Google hash", async () => {
    await getProfileState(session, "l1")
    state.observation = { payload: null, failed: false }
    resetCounters()
    expect((await getProfileState(session, "l1")).source).toBe("live")

    const website = state.fields.get("website")!
    state.fields.set("website", { ...website, googleHash: "f".repeat(64) })
    resetCounters()
    expect((await getProfileState(session, "l1")).source).toBe("live")
    expect(google.location).toHaveBeenCalledOnce()
  })

  it("reads Google when the last read or the sweep failed", async () => {
    await getProfileState(session, "l1")
    state.observation = { ...state.observation!, failed: true }
    resetCounters()
    expect((await getProfileState(session, "l1")).source).toBe("live")
  })

  it("serves a save from storage regardless of age when asked to", async () => {
    await getProfileState(session, "l1")
    vi.setSystemTime(new Date("2026-10-14T13:00:00Z"))
    resetCounters()
    const profile = await getProfileState(session, "l1", {
      maxAgeMs: Infinity,
    })
    expect(profile.source).toBe("stored")
    expect(google.location).not.toHaveBeenCalled()
  })

  it("saves NabaPresence's copy without reading Google", async () => {
    await getProfileState(session, "l1")
    resetCounters()
    const saved = await saveCanonicalProfile({
      session,
      locationId: "l1",
      expectedCanonicalRevision: "1",
      values: { name: "Camden House" },
      requestId: "r1",
    })
    expect(saved).toEqual({ saved: true, revision: "2" })
    expect(google.location).not.toHaveBeenCalled()
    expect(google.token).not.toHaveBeenCalled()
    expect(state.transactions).toBe(1)

    // The next open is still served from storage, now with a local edit.
    resetCounters()
    const after = await getProfileState(session, "l1")
    expect(after.source).toBe("stored")
    expect(after.fields.find((field) => field.key === "name")?.status).not.toBe(
      "in_sync"
    )
    expect(google.location).not.toHaveBeenCalled()
  })

  it("refuses a save against a stale revision without reading Google", async () => {
    await getProfileState(session, "l1")
    resetCounters()
    await expect(
      saveCanonicalProfile({
        session,
        locationId: "l1",
        expectedCanonicalRevision: "0",
        values: { name: "Camden House" },
        requestId: "r1",
      })
    ).rejects.toMatchObject({ code: "canonical_resource_stale" })
    expect(google.location).not.toHaveBeenCalled()
  })
})
