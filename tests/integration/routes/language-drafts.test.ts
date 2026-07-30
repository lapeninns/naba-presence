import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { upsertGoogleReview } from "@/lib/server/reviews"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  saveHumanDraft,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip
const germanReview =
  "Das Frühstück war hervorragend und das Personal sehr freundlich."

describeDatabase("draft language propagation", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  let organisationId: string
  let cookie: string
  let reviewId: string
  let englishReviewId: string

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, { max: 1 })
    const owner = await createTestTenant(admin)
    organisationId = owner.organisationId
    cookie = owner.cookie
    const connection = await seedGoogleConnection(admin, {
      organisationId,
    })
    const seed = await seedLinkedReview(admin, {
      organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    englishReviewId = seed.reviewId
    const [external] = await admin<
      { googleLocationName: string }[]
    >`
      select google_location_name as "googleLocationName"
      from external_location
      where id = ${seed.externalLocationId}
    `
    const providerReviewId = crypto.randomUUID()
    const ingestedReviewId = await runtime.begin(async (sql) => {
      await sql`
        select set_config('app.organisation_id', ${organisationId}, true)
      `
      return upsertGoogleReview(
        sql,
        organisationId,
        {
          externalLocationId: seed.externalLocationId,
          locationId: seed.locationId,
          connectionId: connection.connectionId,
          googleAccountName: connection.googleAccountName,
          googleLocationName: external.googleLocationName,
          verified: true,
        },
        {
          name: `${connection.googleAccountName}/${external.googleLocationName}/reviews/${providerReviewId}`,
          reviewId: providerReviewId,
          reviewer: { displayName: "Deutsche Reisende" },
          starRating: "FIVE",
          comment: germanReview,
          createTime: "2026-07-29T10:00:00.000Z",
          updateTime: "2026-07-29T10:00:00.000Z",
        }
      )
    })
    if (!ingestedReviewId) throw new Error("German review was not ingested")
    reviewId = ingestedReviewId
    server = await startAppServer()
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, [organisationId])
    await runtime.end()
    await admin.end()
  })

  it("keeps the detected German language through the detail payload", async () => {
    const [stored] = await admin<
      { code: string | null; confidence: number | null }[]
    >`
      select
        detected_language_code as code,
        language_confidence::float as confidence
      from review
      where id = ${reviewId}
    `
    expect(stored.code).toBe("de")
    expect(stored.confidence).toBeGreaterThanOrEqual(0.7)

    await saveHumanDraft(
      server.baseUrl,
      cookie,
      reviewId,
      "Vielen Dank für Ihre freundliche Rückmeldung."
    )
    const response = await fetch(`${server.baseUrl}/api/reviews/${reviewId}`, {
      headers: { cookie },
    })
    if (response.status !== 200) {
      throw new Error(`Review detail failed: ${await response.text()}`)
    }
    const payload = (await response.json()) as {
      review: {
        detectedLanguageCode: string | null
        languageConfidence: number | null
      }
    }
    expect(payload.review.detectedLanguageCode).toBe("de")
    expect(payload.review.languageConfidence).toBeGreaterThanOrEqual(0.7)
  })

  it("stores an explicit language override on the draft", async () => {
    const response = await fetch(
      `${server.baseUrl}/api/reviews/${englishReviewId}/drafts`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          tone: "warm_professional",
          body: "Merci beaucoup pour votre retour.",
          languageOverride: "fr",
        }),
      }
    )
    if (response.status !== 201) {
      throw new Error(`Draft creation failed: ${await response.text()}`)
    }
    const { draftId } = (await response.json()) as { draftId: string }
    const [draft] = await admin<{ language: string }[]>`
      select language from draft where id = ${draftId}
    `
    expect(draft.language).toBe("fr")
  })
})
