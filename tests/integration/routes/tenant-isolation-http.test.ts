import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("route tenant isolation", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  let tenantA: Awaited<ReturnType<typeof createTestTenant>>
  let reviewA: Awaited<ReturnType<typeof seedReview>>
  let reviewB: Awaited<ReturnType<typeof seedReview>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    tenantA = await createTestTenant(admin)
    const tenantB = await createTestTenant(admin)
    organisations.push(
      tenantA.organisationId,
      tenantB.organisationId
    )
    reviewA = await seedReview(admin, {
      organisationId: tenantA.organisationId,
      text: "Tenant A review",
    })
    reviewB = await seedReview(admin, {
      organisationId: tenantB.organisationId,
      text: "Tenant B review",
    })
    server = await startAppServer()
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("returns only the signed-in tenant's reviews", async () => {
    const response = await fetch(`${server.baseUrl}/api/reviews`, {
      headers: { cookie: tenantA.cookie },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([
      reviewA.reviewId,
    ])
  })

  it("returns 404 for another tenant's review", async () => {
    const response = await fetch(
      `${server.baseUrl}/api/reviews/${reviewB.reviewId}`,
      { headers: { cookie: tenantA.cookie } }
    )
    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe("review_not_found")
  })

  it("returns 404 when drafting for another tenant's review", async () => {
    const response = await fetch(
      `${server.baseUrl}/api/reviews/${reviewB.reviewId}/drafts`,
      {
        method: "POST",
        headers: {
          cookie: tenantA.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          tone: "warm_professional",
          body: "Thanks for your review.",
        }),
      }
    )
    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe("review_not_found")
  })
})
