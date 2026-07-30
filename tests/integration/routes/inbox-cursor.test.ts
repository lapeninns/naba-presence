import { randomUUID } from "node:crypto"

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
  const sortableReviewIds: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    const owner = await createTestTenant(admin)
    organisationId = owner.organisationId
    cookie = owner.cookie
    const review = await seedReview(admin, { organisationId })
    reviewId = review.reviewId
    sortableReviewIds.push(reviewId)
    for (const offset of [2, 3, 4]) {
      const unratedId = randomUUID()
      const marker = randomUUID()
      sortableReviewIds.push(unratedId)
      await admin`
        insert into review (
          id,
          organisation_id,
          location_id,
          external_location_id,
          google_review_name_ciphertext,
          google_review_name_hash,
          google_review_id_ciphertext,
          google_review_id_hash,
          reviewer_display_name,
          reviewer_is_anonymous,
          star_rating,
          review_text,
          detected_language_code,
          language_confidence,
          has_media,
          create_time,
          update_time,
          content_hash,
          workflow_status,
          raw_payload
        )
        select
          ${unratedId},
          organisation_id,
          location_id,
          external_location_id,
          google_review_name_ciphertext,
          encode(digest(${`name-${marker}`}, 'sha256'), 'hex'),
          google_review_id_ciphertext,
          encode(digest(${`id-${marker}`}, 'sha256'), 'hex'),
          'Unrated reviewer',
          false,
          null,
          'Review with no provider rating.',
          detected_language_code,
          language_confidence,
          false,
          create_time,
          update_time - (${offset} * interval '1 second'),
          encode(digest(${marker}, 'sha256'), 'hex'),
          'new',
          '{}'::jsonb
        from review
        where id = ${reviewId}
      `
    }
    server = await startAppServer()
  })

  afterAll(async () => {
    await server?.stop()
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

    it(`paginates ${sort} across unrated reviews`, async () => {
      const seen: string[] = []
      let cursor: string | null = null
      do {
        const params = new URLSearchParams({
          sort,
          page_size: "1",
          ...(cursor ? { cursor } : {}),
        })
        const response = await fetch(
          `${server.baseUrl}/api/reviews?${params}`,
          { headers: { cookie } }
        )
        expect(response.status, await response.clone().text()).toBe(200)
        const payload = (await response.json()) as {
          items: Array<{ id: string }>
          nextCursor: string | null
        }
        seen.push(...payload.items.map(({ id }) => id))
        cursor = payload.nextCursor
      } while (cursor)

      expect(new Set(seen)).toEqual(new Set(sortableReviewIds))
      expect(seen).toHaveLength(sortableReviewIds.length)
    })
  }
})
