import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedAwaitingApprovalPost,
  seedGoogleConnection,
  seedLinkedLocation,
  seedMemberUser,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase(
  "posts approval reject - per-location authorisation (SEC-1)",
  () => {
    let admin: ReturnType<typeof postgres>
    let server: Awaited<ReturnType<typeof startAppServer>>
    const organisations: string[] = []

    beforeAll(async () => {
      admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
      // Without these flags the reject branch 503s at
      // approval/route.ts:18 before the guard ever runs.
      server = await startAppServer({
        GBP_POSTS_ENABLED: "true",
        PUBLISH_ENABLED: "true",
      })
    })

    afterAll(async () => {
      await server.stop()
      await destroyTenants(admin, organisations)
      await admin.end()
    })

    function reject(cookie: string, locationId: string, postId: string) {
      return fetch(
        `${server.baseUrl}/api/locations/${locationId}/posts/${postId}/approval`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ decision: "reject" }),
        }
      )
    }

    it("a member assigned elsewhere cannot reject a post on another location", async () => {
      const tenant = await createTestTenant(admin, { role: "owner" })
      organisations.push(tenant.organisationId)
      const connection = await seedGoogleConnection(admin, {
        organisationId: tenant.organisationId,
      })
      const locA = await seedLinkedLocation(admin, {
        organisationId: tenant.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
      })
      const locB = await seedLinkedLocation(admin, {
        organisationId: tenant.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
      })
      const member = await seedMemberUser(admin, {
        organisationId: tenant.organisationId,
        role: "member",
        assignLocationId: locA.locationId,
      })
      const post = await seedAwaitingApprovalPost(admin, {
        organisationId: tenant.organisationId,
        locationId: locB.locationId,
        requestedBy: member.userId,
      })

      const response = await reject(member.cookie, locB.locationId, post.id)
      expect(response.status).toBe(404)
      expect(((await response.json()) as { error: string }).error).toBe(
        "review_not_found"
      )

      const [row] = await admin<{ status: string }[]>`
        select status from gbp_local_post where id = ${post.id}
      `
      expect(row.status).toBe("awaiting_approval")
    })

    it("an owner may reject the same post (200 -> draft)", async () => {
      const tenant = await createTestTenant(admin, { role: "owner" })
      organisations.push(tenant.organisationId)
      const connection = await seedGoogleConnection(admin, {
        organisationId: tenant.organisationId,
      })
      const locB = await seedLinkedLocation(admin, {
        organisationId: tenant.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
      })
      const post = await seedAwaitingApprovalPost(admin, {
        organisationId: tenant.organisationId,
        locationId: locB.locationId,
        requestedBy: tenant.userId,
      })

      const response = await reject(tenant.cookie, locB.locationId, post.id)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: "draft" })
    })
  }
)
