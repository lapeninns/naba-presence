import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  saveHumanDraft,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("reply lifecycle harness", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  let owner: Awaited<ReturnType<typeof createTestTenant>>
  let review: Awaited<ReturnType<typeof seedLinkedReview>>
  let draft: Awaited<ReturnType<typeof saveHumanDraft>>

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    owner = await createTestTenant(admin)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    review = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
    })
    draft = await saveHumanDraft(
      server.baseUrl,
      owner.cookie,
      review.reviewId,
      "Thank you for sharing your experience with our team."
    )
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, [owner.organisationId])
    await admin.end()
  })

  it("publishes a seeded linked review through the Google stub", async () => {
    const response = await fetch(
      `${server.baseUrl}/api/reviews/${review.reviewId}/publish`,
      {
        method: "POST",
        headers: {
          cookie: owner.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          draftId: draft.draftId,
          expectedReviewUpdateTime: draft.expectedReviewUpdateTime,
        }),
      }
    )

    expect(response.status).toBe(200)
    expect(
      stub.calls.some(
        (call) => call.method === "PUT" && call.path.endsWith("/reply")
      )
    ).toBe(true)
  })
})
