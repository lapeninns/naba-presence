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

describeDatabase("audit request integrity", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function createFixture() {
    stub.reset()
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const review = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    return { owner, review }
  }

  async function publish(
    fixture: Awaited<ReturnType<typeof createFixture>>,
    draft: Awaited<ReturnType<typeof saveHumanDraft>>,
    headers: Record<string, string> = {}
  ) {
    return fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}/publish`,
      {
        method: "POST",
        headers: {
          cookie: fixture.owner.cookie,
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          draftId: draft.draftId,
          expectedReviewUpdateTime: draft.expectedReviewUpdateTime,
        }),
      }
    )
  }

  async function deleteReply(
    fixture: Awaited<ReturnType<typeof createFixture>>,
    headers: Record<string, string> = {}
  ) {
    return fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}/reply`,
      {
        method: "DELETE",
        headers: { cookie: fixture.owner.cookie, ...headers },
      }
    )
  }

  it("audits every attempt even when the client pins x-request-id", async () => {
    const fixture = await createFixture()
    const pinned = "same-id-every-time"
    const body = "First reply body."
    const draft1 = await saveHumanDraft(
      server.baseUrl,
      fixture.owner.cookie,
      fixture.review.reviewId,
      body
    )
    expect(
      (
        await publish(fixture, draft1, {
          "x-request-id": pinned,
        })
      ).status
    ).toBe(200)
    expect(
      (
        await deleteReply(fixture, {
          "x-request-id": pinned,
        })
      ).status
    ).toBe(200)
    const draft2 = await saveHumanDraft(
      server.baseUrl,
      fixture.owner.cookie,
      fixture.review.reviewId,
      body
    )
    expect(
      (
        await publish(fixture, draft2, {
          "x-request-id": pinned,
        })
      ).status
    ).toBe(200)

    const rows = await admin<{ action: string; count: number }[]>`
      select action, count(*)::int as count
      from audit_log
      where organisation_id = ${fixture.owner.organisationId}
        and action in (
          'review.reply.publish_requested',
          'review.reply.published'
        )
      group by action
    `
    const byAction = Object.fromEntries(
      rows.map((row) => [row.action, row.count])
    )
    expect(byAction["review.reply.publish_requested"]).toBe(2)
    expect(byAction["review.reply.published"]).toBe(2)
  })

  it("correlates one request's audit events under one server id", async () => {
    const fixture = await createFixture()
    const draft = await saveHumanDraft(
      server.baseUrl,
      fixture.owner.cookie,
      fixture.review.reviewId,
      "A uniquely correlated reply."
    )
    expect((await publish(fixture, draft)).status).toBe(200)

    const rows = await admin<{ request_id: string }[]>`
      select distinct request_id
      from audit_log
      where organisation_id = ${fixture.owner.organisationId}
        and action like 'review.reply.%'
    `
    expect(rows).toHaveLength(1)
  })
})
