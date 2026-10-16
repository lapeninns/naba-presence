import { afterEach, describe, expect, it, vi } from "vitest"

import { sessionSchema } from "@/lib/contracts/session"
import { queryKeys } from "@/lib/queries/keys"
import { makeQueryClient } from "@/lib/queries/query-client"
import { sessionScopeToken } from "@/lib/queries/session-scope"
import { operationsPrefetch } from "@/lib/server/operations-prefetch"
import { prefetch } from "@/lib/server/prefetch"
import type { Session } from "@/lib/server/session"

// SET-22: /settings/operations hydrates what OperationsView reads on mount,
// as /team and /settings/notifications do. The readers are the ones the
// routes call (app/api/operations/health, app/api/webhooks/google/pubsub/
// failures, app/api/settings), covered on a real database by their route
// tests; this file pins the contract with the client cache: the right keys,
// for the roles the routes answer, in the shape `apiFetch` would produce.
const SQL = { tag: "tenant-sql" }
vi.mock("@/lib/server/db", () => ({
  withTenant: vi.fn(async (_org: string, fn: (sql: unknown) => unknown) =>
    fn(SQL)
  ),
}))
vi.mock("@/lib/server/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/server/ops-liveness", () => ({
  schedulerLiveness: vi.fn(async () => ({
    schedulerHeartbeatAt: new Date("2026-10-16T09:29:00.000Z"),
    schedulerTicks: [],
  })),
}))
vi.mock("@/lib/server/operations-health", () => ({
  loadOrganisationHealth: vi.fn(),
  loadWebhookFailures: vi.fn(),
}))
vi.mock("@/lib/server/org-settings", () => ({ loadOrgSettings: vi.fn() }))

const ORG = "00000000-0000-4000-8000-000000000001"
const AT = new Date("2026-10-16T09:30:00.000Z")

const owner: Session = {
  sessionId: "00000000-0000-4000-8000-000000000020",
  userId: "00000000-0000-4000-8000-000000000002",
  organisationId: ORG,
  organisationName: "Org",
  workspaceMode: "agency",
  displayName: "Test",
  email: "test@example.test",
  role: "owner",
  canPublish: true,
}

/** What the tenant read returns: timestamps as Dates, before the wire. */
const healthRow = {
  generatedAt: AT.toISOString(),
  aiTokensThisMonth: [],
  sync: {
    running: 0,
    pending: 1,
    failed: 0,
    lastSuccessfulReviewUpdate: AT,
    oldestOutstandingAt: AT,
  },
  webhooks: { backlog: 0, oldestBacklogAt: null, failures24h: 0 },
  connections: [{ status: "active", count: 1 }],
  publish24h: [],
  replyRejections30d: [],
  providerTotalDivergence30d: 0,
  failedWebhookEvents: 1,
  deadWebhookEvents: 0,
  oldestFailedEventAgeSeconds: 60,
  ambiguousPublishAttempts: 0,
  staleStartedAttempts: 0,
  dueJobBacklog: 0,
  checkpointFailures24h: 0,
  connectionErrors24h: 0,
  schedulerHeartbeatAt: AT,
  schedulerTicks: [],
  unresolvedWrites: [],
  notificationDeliveries: {
    queued: 0,
    oldestQueuedAt: null,
    retryable: 0,
    states7d: [],
  },
}

const failureRow = {
  id: "00000000-0000-4000-8000-000000000060",
  eventType: "NEW_REVIEW",
  status: "failed",
  retryCount: 2,
  nextAttemptAt: AT,
  lastErrorCode: "timeout",
  receivedAt: AT,
}

const keys = (entries: { queryKey: readonly unknown[] }[]) =>
  entries.map((entry) => entry.queryKey)

afterEach(() => vi.clearAllMocks())

describe("operationsPrefetch", () => {
  it("hydrates the health, the failed events and the time zone for an owner or admin", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(keys(operationsPrefetch()({ ...owner, role }))).toEqual([
        queryKeys.operationsHealth,
        queryKeys.webhookFailures,
        queryKeys.settings,
      ])
    }
  })

  it("reads nothing for a member or viewer, whom both routes refuse", () => {
    for (const role of ["member", "viewer"] as const) {
      expect(operationsPrefetch()({ ...owner, role })).toEqual([])
    }
  })

  it("stores the payloads as the browser would have parsed them", async () => {
    const { loadOrganisationHealth, loadWebhookFailures } =
      await import("@/lib/server/operations-health")
    const { schedulerLiveness } = await import("@/lib/server/ops-liveness")
    const { loadOrgSettings } = await import("@/lib/server/org-settings")
    vi.mocked(loadOrganisationHealth).mockResolvedValueOnce(healthRow as never)
    vi.mocked(loadWebhookFailures).mockResolvedValueOnce({
      items: [failureRow],
    })
    vi.mocked(loadOrgSettings).mockRejectedValueOnce(new Error("db down"))

    const client = makeQueryClient()
    await prefetch(owner, operationsPrefetch(), client)

    // The tenant read gets the liveness read outside the tenant.
    expect(loadOrganisationHealth).toHaveBeenCalledWith(
      SQL,
      await vi.mocked(schedulerLiveness).mock.results[0].value
    )
    expect(loadWebhookFailures).toHaveBeenCalledWith(SQL)
    expect(client.getQueryData(queryKeys.operationsHealth)).toMatchObject({
      sync: { pending: 1, lastSuccessfulReviewUpdate: AT.toISOString() },
      schedulerHeartbeatAt: AT.toISOString(),
      failedWebhookEvents: 1,
    })
    expect(client.getQueryData(queryKeys.webhookFailures)).toEqual({
      items: [
        {
          ...failureRow,
          nextAttemptAt: AT.toISOString(),
          receivedAt: AT.toISOString(),
        },
      ],
    })
    // One failed read leaves its key for the client to fetch; the others
    // still hydrate.
    expect(client.getQueryData(queryKeys.settings)).toBeUndefined()
  })

  it("stamps the payload with the session's scope token", async () => {
    const state = await prefetch(owner, operationsPrefetch())
    expect(state.scope).toBe(sessionScopeToken(sessionSchema.parse(owner)))
  })
})
