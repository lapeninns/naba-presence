import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { createTestTenant, destroyTenants, seedReview } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

/**
 * GET /api/shell-status is the shell's one poll (R2-X1 M4). The client seeds
 * the counts, connections and notifications-badge caches from it, so each
 * part must be exactly what that part's own route answers.
 */
describeDatabase("GET /api/shell-status", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    server = await startAppServer()
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function read(path: string, cookie: string) {
    const response = await fetch(`${server.baseUrl}${path}`, {
      headers: { cookie },
    })
    expect(response.status).toBe(200)
    return response.json()
  }

  it("answers what the counts, connections and notifications routes answer", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    await seedReview(admin, { organisationId: owner.organisationId })

    const status = await read("/api/shell-status", owner.cookie)
    expect(status.counts).toEqual(
      await read("/api/reviews/counts", owner.cookie)
    )
    expect(status.counts.byQueue.needs_reply).toBeGreaterThan(0)
    expect({ connections: status.connections }).toEqual(
      await read("/api/google/connections", owner.cookie)
    )
    expect(status.connections.length).toBeGreaterThan(0)
    const notifications = await read(
      "/api/notifications?filter=unread",
      owner.cookie
    )
    expect(status.notifications).toEqual({
      items: notifications.items,
      nextCursor: notifications.nextCursor,
      unreadCount: notifications.unreadCount,
    })
  })

  it("needs a session", async () => {
    const response = await fetch(`${server.baseUrl}/api/shell-status`)
    expect(response.status).toBe(401)
  })
})
