import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "./helpers/tenant"

vi.mock("server-only", () => ({}))

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

// S3: the Reports "What guests talk about" reader. Database only, scoped by
// the viewer's visibility and the client or listing asked for, counting
// only the labels of current classifications.
describeDatabase("review topic report", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  let loadReviewTopicReport: typeof import("@/lib/server/review-topics").loadReviewTopicReport
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, { max: 1 })
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL!
    process.env.NEXTAUTH_SECRET = "topic-report-test-session-secret-32-chars"
    process.env.TOKEN_ENCRYPTION_KEY =
      "topic-report-test-token-key-32-characters"
    process.env.CRON_SECRET = "topic-report-test-cron-secret"
    ;({ loadReviewTopicReport } = await import("@/lib/server/review-topics"))
  })

  afterAll(async () => {
    await destroyTenants(admin, organisations)
    await runtime.end()
    await admin.end()
  })

  /** Two listings, each with one classified review about service. */
  async function fixture() {
    const tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const seeded = []
    for (const [text, sentiment] of [
      ["Slow service all night.", "negative"],
      ["Lovely staff.", "positive"],
    ] as const) {
      const review = await seedLinkedReview(admin, {
        organisationId: tenant.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
        text,
      })
      await admin`
        insert into review_topic_classification (
          organisation_id, review_id, status, text_hash, model,
          review_update_time, classified_at
        ) values (
          ${tenant.organisationId}, ${review.reviewId}, 'classified',
          md5(${text}), 'test-model', now(), now()
        )
      `
      await admin`
        insert into review_topic (
          organisation_id, review_id, topic, sentiment, model, classified_at,
          review_update_time
        ) values (
          ${tenant.organisationId}, ${review.reviewId}, 'service',
          ${sentiment}, 'test-model', now(), now()
        )
      `
      seeded.push(review)
    }
    return { tenant, reviews: seeded }
  }

  function read(
    organisationId: string,
    viewer: { role: "owner" | "member"; userId: string },
    query: { clientId?: string; locationId?: string } = {}
  ) {
    return runtime.begin(async (sql) => {
      await sql`
        select set_config('app.organisation_id', ${organisationId}, true)
      `
      return loadReviewTopicReport(
        sql as never,
        { ...viewer, organisationId },
        query
      )
    })
  }

  const service = <T extends { topic: string }>(scope: { topics: T[] }) =>
    scope.topics.find((line) => line.topic === "service")!

  it("counts every listing an owner sees, and one listing when asked", async () => {
    const { tenant, reviews } = await fixture()
    const owner = { role: "owner" as const, userId: tenant.userId }
    const all = await read(tenant.organisationId, owner)
    expect(all.locations).toHaveLength(2)
    expect(all.group.classifiedReviews).toBe(2)
    expect(service(all.group)).toMatchObject({
      mentions: 2,
      negative: 1,
      share: 1,
      negativeShare: 0.5,
    })
    expect(all.weeks).toHaveLength(8)

    const one = await read(tenant.organisationId, owner, {
      locationId: reviews[0].locationId,
    })
    expect(one.locations.map((l) => l.locationId)).toEqual([
      reviews[0].locationId,
    ])
    expect(service(one.group)).toMatchObject({ mentions: 1, negative: 1 })
  })

  it("shows a member assigned to one listing only that listing", async () => {
    const { tenant, reviews } = await fixture()
    await admin`
      -- The org's only owner cannot be demoted; the viewer below reads as a
      -- member, and its membership scope is what visibility consults.
      update member set location_scope = 'assigned'
      where organisation_id = ${tenant.organisationId}
        and user_id = ${tenant.userId}
    `
    await admin`
      insert into location_member (organisation_id, location_id, user_id)
      values (${tenant.organisationId}, ${reviews[1].locationId}, ${tenant.userId})
    `
    const member = { role: "member" as const, userId: tenant.userId }
    const report = await read(tenant.organisationId, member)
    expect(report.locations.map((l) => l.locationId)).toEqual([
      reviews[1].locationId,
    ])
    expect(service(report.group)).toMatchObject({ mentions: 1, negative: 0 })
    // Asking for the other listing by id widens nothing.
    const other = await read(tenant.organisationId, member, {
      locationId: reviews[0].locationId,
    })
    expect(other.locations).toEqual([])
    expect(other.group.classifiedReviews).toBe(0)
  })

  it("narrows to a client and reads nothing of another organisation", async () => {
    const { tenant } = await fixture()
    const owner = { role: "owner" as const, userId: tenant.userId }
    const nobody = await read(tenant.organisationId, owner, {
      clientId: randomUUID(),
    })
    expect(nobody.locations).toEqual([])
    const elsewhere = await fixture()
    const crossed = await read(elsewhere.tenant.organisationId, owner)
    // The other organisation's own two listings, never this one's.
    expect(crossed.locations).toHaveLength(2)
    expect(crossed.group.classifiedReviews).toBe(2)
  })

  it("counts an edited review waiting to be classified again as pending, not twice", async () => {
    const { tenant, reviews } = await fixture()
    await admin`
      update review_topic_classification set status = 'pending'
      where review_id = ${reviews[0].reviewId}
    `
    const report = await read(tenant.organisationId, {
      role: "owner",
      userId: tenant.userId,
    })
    expect(report.group.classifiedReviews).toBe(1)
    expect(report.pendingReviews).toBe(1)
    const line = service(report.group)
    expect(line.mentions).toBe(1)
    expect(line.share).toBeLessThanOrEqual(1)
  })
})
