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

// S3 (coordinator decision 2026-10-30): a privacy erasure deletes the
// review's topic labels and its classification row, and nothing of any
// other review or organisation.
describeDatabase("privacy erasure of review topics", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  let eraseReviews: typeof import("@/lib/server/privacy/fulfil").eraseReviews
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, { max: 1 })
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL!
    process.env.NEXTAUTH_SECRET = "topic-erasure-test-session-secret-32-chars"
    process.env.TOKEN_ENCRYPTION_KEY =
      "topic-erasure-test-token-key-32-characters"
    process.env.CRON_SECRET = "topic-erasure-test-cron-secret"
    ;({ eraseReviews } = await import("@/lib/server/privacy/fulfil"))
  })

  afterAll(async () => {
    await destroyTenants(admin, organisations)
    await runtime.end()
    await admin.end()
  })

  /** An organisation with two classified reviews, each with two labels. */
  async function organisation() {
    const tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const reviewIds: string[] = []
    for (const text of ["Cold roast, slow service.", "Great pint."]) {
      const { reviewId } = await seedLinkedReview(admin, {
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
          ${tenant.organisationId}, ${reviewId}, 'classified', md5(${text}),
          'test-model', now(), now()
        )
      `
      for (const topic of ["service", "drinks"]) {
        await admin`
          insert into review_topic (
            organisation_id, review_id, topic, sentiment, model,
            classified_at, review_update_time
          ) values (
            ${tenant.organisationId}, ${reviewId}, ${topic}, 'neutral',
            'test-model', now(), now()
          )
        `
      }
      reviewIds.push(reviewId)
    }
    return { organisationId: tenant.organisationId, reviewIds }
  }

  function erase(organisationId: string, reviewIds: string[]) {
    return runtime.begin(async (sql) => {
      await sql`
        select set_config('app.organisation_id', ${organisationId}, true)
      `
      return eraseReviews(sql as never, organisationId, reviewIds)
    })
  }

  async function remaining(reviewId: string) {
    const [row] = await admin<{ topics: number; classified: number }[]>`
      select
        (select count(*)::int from review_topic where review_id = ${reviewId})
          as topics,
        (select count(*)::int from review_topic_classification
          where review_id = ${reviewId}) as classified
    `
    return row
  }

  it("deletes the erased review's labels and classification, and no other review's", async () => {
    const own = await organisation()
    const [erased, kept] = own.reviewIds

    const scrub = await erase(own.organisationId, [erased])

    expect(scrub.reviewsAffected).toBe(1)
    expect(scrub.topicsRemoved).toBe(2)
    expect(await remaining(erased)).toEqual({ topics: 0, classified: 0 })
    expect(await remaining(kept)).toEqual({ topics: 2, classified: 1 })
  })

  it("never deletes another organisation's labels, even when handed its review ids", async () => {
    const own = await organisation()
    const other = await organisation()

    // A caller bug passing a foreign id: RLS and the organisation filter
    // both stand in the way.
    const scrub = await erase(own.organisationId, [other.reviewIds[0]])

    expect(scrub.reviewsAffected).toBe(0)
    expect(scrub.topicsRemoved).toBe(0)
    expect(await remaining(other.reviewIds[0])).toEqual({
      topics: 2,
      classified: 1,
    })
    for (const reviewId of own.reviewIds) {
      expect(await remaining(reviewId)).toEqual({ topics: 2, classified: 1 })
    }
  })

  it("leaves nothing for the classifier to send again after erasure", async () => {
    const own = await organisation()
    await erase(own.organisationId, [own.reviewIds[0]])
    const [review] = await admin<
      { text: string | null; erasedAt: Date | null }[]
    >`
      select review_text as text, erased_at as "erasedAt"
      from review where id = ${own.reviewIds[0]}
    `
    // No text and an erasure marker: the classifier's due query and claim
    // both require text and erased_at null, so the review is never sent.
    expect(review.text).toBeNull()
    expect(review.erasedAt).not.toBeNull()
  })
})
