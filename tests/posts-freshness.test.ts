import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Session } from "@/lib/server/session"

// W3-2 (WP-11): the posts list's first page is served from the stored rows
// of a reconciliation within the editors' staleness budget: no Google call,
// two read-only transactions. Past the budget, on `refresh`, for the
// ambiguous-post check, with a post whose publish never settled, or after a
// writer dropped the observation, it reconciles with Google first.

const state = vi.hoisted(() => ({
  transactions: 0,
  writes: 0,
  unsettled: false,
  observation: null as null | { payload: unknown; failed: boolean },
}))
const google = vi.hoisted(() => ({
  localPosts: vi.fn(),
  token: vi.fn(async () => "synthetic-token"),
}))
const observations = vi.hoisted(() => ({
  record: vi.fn(),
  forget: vi.fn(),
}))

function sqlFor() {
  return vi.fn((strings: TemplateStringsArray | string) => {
    // sql(identifier) builds a fragment.
    if (!Array.isArray(strings)) return ""
    const text = strings.join("?")
    if (/\b(insert|update|delete)\b/i.test(text)) state.writes += 1
    if (text.includes("as unsettled"))
      return Promise.resolve([{ unsettled: state.unsettled }])
    if (text.includes('count(*)::integer as "all"'))
      return Promise.resolve([
        { all: 0, draft: 0, awaiting: 0, published: 0, attention: 0, live: 0 },
      ])
    return Promise.resolve([])
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
  gbpWritesEnabled: () => true,
}))
vi.mock("@/lib/server/permissions", () => ({
  requireLocationAccess: vi.fn(),
  requireLocationAction: vi.fn(),
}))
vi.mock("@/lib/server/gbp-write", () => ({
  attemptStore: () => ({}),
  idempotencyKey: vi.fn(),
  requireGbpWrite: vi.fn(),
  requirePublishGrant: vi.fn(),
  runGbpWrite: vi.fn(),
  loadLinkedLocation: async () => ({
    organisationId: "o1",
    locationId: "l1",
    externalLocationId: "e1",
    googleAccountName: "accounts/1",
    googleLocationName: "locations/l1",
    googleConnectionId: "c1",
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
  googleLocalPosts: google.localPosts,
  createGoogleLocalPost: vi.fn(),
  deleteGoogleLocalPost: vi.fn(),
  getGoogleLocalPost: vi.fn(),
  patchGoogleLocalPost: vi.fn(),
}))

const { listLocalPosts } = await import("@/lib/server/posts")
const { encodePostsCursor } = await import("@/lib/contracts/location-posts")

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

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-14T12:00:00Z"), toFake: ["Date"] })
  vi.clearAllMocks()
  state.transactions = 0
  state.writes = 0
  state.unsettled = false
  state.observation = null
  google.localPosts.mockResolvedValue({ localPosts: [] })
  observations.record.mockImplementation(
    async (_sql: unknown, input: { googlePayload?: unknown }) => {
      state.observation = {
        payload: input.googlePayload ?? state.observation?.payload ?? null,
        failed: false,
      }
    }
  )
})

function resetCounters() {
  vi.clearAllMocks()
  state.transactions = 0
  state.writes = 0
}

const list = (options = {}) => listLocalPosts("o1", session, "l1", options)

describe("posts list freshness", () => {
  it("reconciles with Google on the first open and records when", async () => {
    const page = await list()
    expect(page.source).toBe("live")
    expect(page.observedAt).toBe("2026-10-14T12:00:00.000Z")
    expect(google.localPosts).toHaveBeenCalledOnce()
    expect(observations.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        resource: "posts",
        googlePayload: {
          observedAt: "2026-10-14T12:00:00.000Z",
          googleLocationName: "locations/l1",
        },
      })
    )
  })

  it("serves the first page within the budget: no Google call, two transactions, no write", async () => {
    await list()
    resetCounters()
    vi.setSystemTime(new Date("2026-10-14T12:04:59Z"))

    const page = await list()

    expect(google.localPosts).not.toHaveBeenCalled()
    expect(google.token).not.toHaveBeenCalled()
    expect(state.transactions).toBeLessThanOrEqual(2)
    expect(state.writes).toBe(0)
    expect(observations.record).not.toHaveBeenCalled()
    expect(page).toMatchObject({
      source: "stored",
      observedAt: "2026-10-14T12:00:00.000Z",
      reconciliationError: null,
    })
  })

  it("reconciles once when stale, on refresh, and for the ambiguous-post check", async () => {
    await list()
    for (const options of [
      { refresh: "1" as const },
      { post: "00000000-0000-4000-8000-000000000001" },
    ]) {
      resetCounters()
      expect((await list(options)).source).toBe("live")
      expect(google.localPosts).toHaveBeenCalledOnce()
    }
    resetCounters()
    vi.setSystemTime(new Date("2026-10-14T12:05:01Z"))
    expect((await list()).source).toBe("live")
    expect(google.localPosts).toHaveBeenCalledOnce()
  })

  it("reconciles while a publish is unsettled, after a failure, a dropped observation or a relink", async () => {
    await list()
    const payload = state.observation!.payload as Record<string, unknown>
    const cases: Array<() => void> = [
      () => (state.unsettled = true),
      () => (state.observation = { payload, failed: true }),
      () => (state.observation = { payload: null, failed: false }),
      () =>
        (state.observation = {
          payload: { ...payload, googleLocationName: "locations/other" },
          failed: false,
        }),
    ]
    for (const arrange of cases) {
      state.unsettled = false
      state.observation = { payload, failed: false }
      arrange()
      resetCounters()
      expect((await list()).source).toBe("live")
      expect(google.localPosts).toHaveBeenCalledOnce()
    }
  })

  it("reads later pages from the database only", async () => {
    const locationId = "00000000-0000-4000-8000-0000000000aa"
    const cursor = encodePostsCursor({
      version: 1,
      locationId,
      filter: "all",
      at: null,
      id: "00000000-0000-4000-8000-000000000002",
    })
    const page = await listLocalPosts("o1", session, locationId, { cursor })
    expect(google.localPosts).not.toHaveBeenCalled()
    expect(state.transactions).toBe(1)
    expect(page.source).toBeNull()
  })

  it("keeps serving the rows, with the last reconciliation's time, when Google cannot be read", async () => {
    await list()
    vi.setSystemTime(new Date("2026-10-14T12:10:00Z"))
    google.localPosts.mockRejectedValue(
      Object.assign(new Error("down"), { code: "google_unavailable" })
    )
    resetCounters()
    const page = await list()
    expect(page.reconciliationError).toBe("google_unavailable")
    expect(page.observedAt).toBe("2026-10-14T12:00:00.000Z")
    expect(observations.record).not.toHaveBeenCalled()
  })
})
