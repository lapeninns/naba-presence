import { randomUUID } from "node:crypto"
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

describeDatabase("analytics response metrics and provider totals", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisationIds: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: stub.baseUrl })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, organisationIds)
    await admin.end()
  })

  async function createReviewFixture() {
    stub.reset()
    const owner = await createTestTenant(admin)
    organisationIds.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const review = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      text: "A detailed review for analytics timing.",
    })
    return { owner, connection, review }
  }

  async function publish(
    cookie: string,
    reviewId: string,
    draft: Awaited<ReturnType<typeof saveHumanDraft>>
  ) {
    const response = await fetch(
      `${server.baseUrl}/api/reviews/${reviewId}/publish`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          draftId: draft.draftId,
          expectedReviewUpdateTime: draft.expectedReviewUpdateTime,
        }),
      }
    )
    if (!response.ok) {
      throw new Error(`Publish failed: ${await response.text()}`)
    }
  }

  async function analytics(
    cookie: string,
    from: Date,
    to: Date
  ): Promise<{
    summary: {
      medianFirstResponseSeconds: number | null
      p95FirstResponseSeconds: number | null
      medianLatestEditSeconds: number | null
    }
    providerTotals?: {
      averageRating: number | null
      totalReviewCount: number | null
      localReviewCount: number
      divergence: boolean
    }
  }> {
    const response = await fetch(
      `${server.baseUrl}/api/analytics/overview?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      { headers: { cookie } }
    )
    if (!response.ok) {
      throw new Error(`Analytics failed: ${await response.text()}`)
    }
    return response.json()
  }

  it("keeps first response fixed while latest edit moves", async () => {
    const fixture = await createReviewFixture()
    stub.respond({ method: "PUT", pathIncludes: "/reply" }, () => ({
      status: 200,
      json: {
        comment: "First published reply.",
        updateTime: "2026-08-01T02:00:00.000Z",
      },
    }))
    const firstDraft = await saveHumanDraft(
      server.baseUrl,
      fixture.owner.cookie,
      fixture.review.reviewId,
      "First published reply."
    )
    await publish(
      fixture.owner.cookie,
      fixture.review.reviewId,
      firstDraft
    )
    const [first] = await admin<{ firstPublishedAt: Date }[]>`
      select first_published_at as "firstPublishedAt"
      from review_reply
      where review_id = ${fixture.review.reviewId}
    `
    const createTime = new Date(
      first.firstPublishedAt.getTime() - 2 * 60 * 60 * 1000
    )
    const latestEdit = new Date(
      first.firstPublishedAt.getTime() + 48 * 60 * 60 * 1000
    )
    await admin`
      update review set create_time = ${createTime}
      where id = ${fixture.review.reviewId}
    `
    stub.respond({ method: "PUT", pathIncludes: "/reply" }, () => ({
      status: 200,
      json: {
        comment: "Edited published reply.",
        updateTime: latestEdit.toISOString(),
      },
    }))
    const secondDraft = await saveHumanDraft(
      server.baseUrl,
      fixture.owner.cookie,
      fixture.review.reviewId,
      "Edited published reply."
    )
    await publish(
      fixture.owner.cookie,
      fixture.review.reviewId,
      secondDraft
    )
    const [edited] = await admin<{
      firstPublishedAt: Date
      latestEditAt: Date
    }[]>`
      select
        first_published_at as "firstPublishedAt",
        google_reply_updated_at as "latestEditAt"
      from review_reply
      where review_id = ${fixture.review.reviewId}
    `
    expect(edited.firstPublishedAt.toISOString()).toBe(
      first.firstPublishedAt.toISOString()
    )
    expect(edited.latestEditAt.toISOString()).toBe(
      latestEdit.toISOString()
    )

    const result = await analytics(
      fixture.owner.cookie,
      new Date(createTime.getTime() - 60_000),
      new Date(latestEdit.getTime() + 60_000)
    )
    expect(result.summary.medianFirstResponseSeconds).toBeCloseTo(7200, 0)
    expect(result.summary.p95FirstResponseSeconds).toBeCloseTo(7200, 0)
    expect(result.summary.medianLatestEditSeconds).toBeCloseTo(180000, 0)
  })

  it("excludes deleted replies from both response metrics", async () => {
    const fixture = await createReviewFixture()
    const draft = await saveHumanDraft(
      server.baseUrl,
      fixture.owner.cookie,
      fixture.review.reviewId,
      "A reply that will be deleted."
    )
    await publish(fixture.owner.cookie, fixture.review.reviewId, draft)
    const [reply] = await admin<{ firstPublishedAt: Date }[]>`
      select first_published_at as "firstPublishedAt"
      from review_reply
      where review_id = ${fixture.review.reviewId}
    `
    const createTime = new Date(
      reply.firstPublishedAt.getTime() - 2 * 60 * 60 * 1000
    )
    await admin`
      update review set create_time = ${createTime}
      where id = ${fixture.review.reviewId}
    `
    const deleted = await fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}/reply`,
      {
        method: "DELETE",
        headers: { cookie: fixture.owner.cookie },
      }
    )
    if (!deleted.ok) {
      throw new Error(`Delete failed: ${await deleted.text()}`)
    }
    const result = await analytics(
      fixture.owner.cookie,
      new Date(createTime.getTime() - 60_000),
      new Date(Date.now() + 60_000)
    )
    expect(result.summary.medianFirstResponseSeconds).toBeNull()
    expect(result.summary.p95FirstResponseSeconds).toBeNull()
    expect(result.summary.medianLatestEditSeconds).toBeNull()
  })

  it("reconciles provider totals from the first sync page", async () => {
    const fixture = await createReviewFixture()
    await admin`
      delete from review where id = ${fixture.review.reviewId}
    `
    const [external] = await admin<{
      googleLocationName: string
    }[]>`
      select google_location_name as "googleLocationName"
      from external_location
      where id = ${fixture.review.externalLocationId}
    `
    const reviews = Array.from({ length: 50 }, (_, index) => {
      const reviewId = randomUUID()
      return {
        name: `${fixture.connection.googleAccountName}/${external.googleLocationName}/reviews/${reviewId}`,
        reviewId,
        reviewer: { displayName: `Provider reviewer ${index}` },
        starRating: "FIVE",
        comment: `Provider review ${index}`,
        createTime: "2026-08-01T10:00:00.000Z",
        updateTime: "2026-08-01T10:00:00.000Z",
      }
    })
    stub.respond({ method: "GET", pathIncludes: "/reviews" }, () => ({
      status: 200,
      json: {
        reviews,
        averageRating: 4.4,
        totalReviewCount: 120,
      },
    }))
    const backfill = await fetch(`${server.baseUrl}/api/sync/backfill`, {
      method: "POST",
      headers: {
        cookie: fixture.owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        externalLocationIds: [fixture.review.externalLocationId],
        maxPagesPerLocation: 1,
      }),
    })
    if (!backfill.ok) {
      throw new Error(`Backfill failed: ${await backfill.text()}`)
    }
    const result = await analytics(
      fixture.owner.cookie,
      new Date("2026-07-31T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z")
    )
    expect(result.providerTotals).toEqual({
      averageRating: 4.4,
      totalReviewCount: 120,
      localReviewCount: 50,
      divergence: true,
    })
    const [stored] = await admin<{ totalReviewCount: number | null }[]>`
      select google_total_review_count as "totalReviewCount"
      from external_location
      where id = ${fixture.review.externalLocationId}
    `
    expect(stored.totalReviewCount).toBe(120)
  })
})
