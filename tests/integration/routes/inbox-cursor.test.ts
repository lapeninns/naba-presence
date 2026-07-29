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

describeDatabase("inbox rating cursor validation", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  let organisationId: string
  let cookie: string
  let reviewId: string

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    const owner = await createTestTenant(admin)
    organisationId = owner.organisationId
    cookie = owner.cookie
    const review = await seedReview(admin, { organisationId })
    reviewId = review.reviewId
    server = await startAppServer()
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, [organisationId])
    await admin.end()
  })

  for (const sort of ["rating_desc", "rating_asc"]) {
    it(`rejects a ${sort} cursor without a rating`, async () => {
      const cursor = Buffer.from(
        JSON.stringify({
          updateTime: new Date().toISOString(),
          id: reviewId,
        })
      ).toString("base64url")
      const response = await fetch(
        `${server.baseUrl}/api/reviews?sort=${sort}&cursor=${cursor}`,
        { headers: { cookie } }
      )
      expect(response.status).toBe(400)
      expect((await response.json()).error).toBe("invalid_cursor")
    })
  }
})
