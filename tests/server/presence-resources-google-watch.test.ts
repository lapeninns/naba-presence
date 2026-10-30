import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

/**
 * The presence sweep runs the Google change watch (S5) for each location it
 * observed, after that location's resources reconcile, so alerts arrive
 * without anyone pressing "Check Google now". The watch is DB only and
 * isolated: its failure is logged and never fails the observation or the
 * rest of the sweep.
 */

const ORGANISATION = "11111111-1111-4111-8111-111111111111"
const LOCATIONS = [
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
]

const watchGoogleChanges = vi.fn()
const getHoursState = vi.fn()
const readProfileStateBundle = vi.fn()
const loadPlaceActions = vi.fn()
const logError = vi.fn()

vi.mock("@/lib/server/route", () => ({
  route: (config: unknown) => config,
}))
vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({ IMPORT_REVIEW_ENABLED: false }),
}))
vi.mock("@/lib/server/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: logError },
}))
vi.mock("@/lib/server/google-change-watch", () => ({ watchGoogleChanges }))
vi.mock("@/lib/server/hours", () => ({ getHoursState }))
vi.mock("@/lib/server/profile", () => ({ readProfileStateBundle }))
vi.mock("@/lib/server/place-actions", () => ({ loadPlaceActions }))
vi.mock("@/lib/server/posts", () => ({
  listLocalPosts: async () => ({ reconciliationError: null }),
}))
vi.mock("@/lib/server/media", () => ({ loadMedia: async () => ({}) }))
vi.mock("@/lib/server/food-menus", () => ({
  readLiveFoodMenus: async () => ({ state: {} }),
}))
vi.mock("@/lib/server/import-review", () => ({
  raiseFoodMenuProposals: vi.fn(),
  raiseProfileProposals: vi.fn(),
  reapStrandedProposals: async () => 0,
}))
vi.mock("@/lib/server/leases", () => ({
  withFleetLease: async (_name: string, fn: () => unknown) => fn(),
}))
vi.mock("@/lib/server/cron-query", () => ({ cronPageInput: vi.fn() }))
vi.mock("@/lib/server/cron-cursor", () => ({ followCronCursor: vi.fn() }))

// One organisation with a job route; its owner and the due locations.
const tenantSql = vi.fn((strings: TemplateStringsArray) => {
  const query = strings.join("?")
  if (query.includes("from member m"))
    return Promise.resolve([
      {
        userId: "44444444-4444-4444-8444-444444444444",
        organisationName: "Old Crown Group",
        workspaceMode: "single",
        displayName: "Owner",
        email: "owner@example.com",
        role: "owner",
        canPublish: true,
      },
    ])
  if (query.includes("from location l"))
    return Promise.resolve(LOCATIONS.map((id) => ({ id })))
  return Promise.resolve([])
})
vi.mock("@/lib/server/db", () => ({
  getDatabase: () => (strings: TemplateStringsArray) =>
    strings.join("?").includes("organisation_job_route")
      ? Promise.resolve([{ id: ORGANISATION }])
      : "",
  withTenant: async (_organisationId: string, fn: (sql: never) => unknown) =>
    fn(tenantSql as never),
}))

type Outcome = {
  organisationId: string
  locationId: string
  resource: string
  status: string
}
type Handler = (input: {
  body: { maxOrganisations: number; maxLocations: number }
  requestId: string
}) => Promise<{ outcomes: Outcome[] }>

async function sweep() {
  const { POST } =
    (await import("@/app/api/sync/presence-resources/route")) as unknown as {
      POST: { handler: Handler }
    }
  return POST.handler({
    body: { maxOrganisations: 10, maxLocations: 5 },
    requestId: "req-sweep",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  watchGoogleChanges.mockResolvedValue({
    found: 0,
    resolved: 0,
    superseded: 0,
  })
  getHoursState.mockResolvedValue({})
  readProfileStateBundle.mockResolvedValue({ state: {} })
  loadPlaceActions.mockResolvedValue({})
})

describe("presence sweep and the Google change watch (S5)", () => {
  it("runs the watch once per observed location, after all its resources", async () => {
    const { outcomes } = await sweep()
    expect(outcomes).toHaveLength(12)
    expect(outcomes.every((outcome) => outcome.status === "succeeded")).toBe(
      true
    )
    expect(watchGoogleChanges.mock.calls).toEqual(
      LOCATIONS.map((locationId) => [
        { organisationId: ORGANISATION, locationId },
      ])
    )
    // After the location's last resource (place actions), not between them.
    for (const [
      index,
      order,
    ] of watchGoogleChanges.mock.invocationCallOrder.entries()) {
      expect(order).toBeGreaterThan(
        loadPlaceActions.mock.invocationCallOrder[index]!
      )
    }
    expect(logError).not.toHaveBeenCalled()
  })

  it("logs a watch failure and keeps the observation and the rest of the sweep", async () => {
    watchGoogleChanges.mockRejectedValueOnce(new Error("watch broke"))
    const { outcomes } = await sweep()
    // Every resource of both locations still recorded as observed.
    expect(outcomes).toHaveLength(12)
    expect(outcomes.every((outcome) => outcome.status === "succeeded")).toBe(
      true
    )
    // The second location is still watched.
    expect(watchGoogleChanges).toHaveBeenCalledTimes(2)
    expect(logError).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledWith(
      "presence_resources.google_watch_failed",
      expect.objectContaining({
        requestId: "req-sweep",
        organisationId: ORGANISATION,
        locationId: LOCATIONS[0],
        error: expect.any(Error),
      })
    )
  })

  it("still watches when only one of hours and profile was read", async () => {
    getHoursState.mockRejectedValue(new Error("hours read failed"))
    await sweep()
    expect(watchGoogleChanges).toHaveBeenCalledTimes(2)
  })

  it("does not watch a location whose hours and profile were both not read", async () => {
    getHoursState.mockRejectedValue(new Error("hours read failed"))
    readProfileStateBundle.mockRejectedValue(new Error("profile read failed"))
    const { outcomes } = await sweep()
    expect(
      outcomes
        .filter((outcome) => outcome.status === "failed")
        .map((outcome) => outcome.resource)
        .sort()
    ).toEqual(["hours", "hours", "profile", "profile"])
    expect(watchGoogleChanges).not.toHaveBeenCalled()
  })
})
