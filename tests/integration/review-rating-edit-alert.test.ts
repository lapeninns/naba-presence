import { randomUUID } from "node:crypto"

import postgres, { type TransactionSql } from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { LinkedLocation } from "@/lib/server/reviews"

import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "./helpers/tenant"

vi.mock("server-only", () => ({}))

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

type Payload = Record<string, unknown>
type Fixture = {
  organisationId: string
  userId: string
  linked: LinkedLocation
}

const DAY_MS = 86_400_000
const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString()

describeDatabase("low-rating alert on a review edited down", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  let upsertGoogleReview: typeof import("@/lib/server/reviews").upsertGoogleReview
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, { max: 1 })
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL!
    ;({ upsertGoogleReview } = await import("@/lib/server/reviews"))
  })

  afterAll(async () => {
    await destroyTenants(admin, organisations)
    await runtime.end()
    await admin.end()
  })

  async function createFixture(): Promise<Fixture> {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const seed = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    return {
      organisationId: owner.organisationId,
      userId: owner.userId,
      linked: {
        externalLocationId: seed.externalLocationId,
        locationId: seed.locationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
        googleLocationName: seed.googleLocationName,
        verified: true,
      },
    }
  }

  function providerReview(fixture: Fixture, overrides: Payload = {}): Payload {
    const name = `${fixture.linked.googleAccountName}/${fixture.linked.googleLocationName}/reviews/${randomUUID()}`
    return {
      name,
      reviewId: name.split("/").at(-1),
      reviewer: { displayName: "Provider reviewer" },
      starRating: "FIVE",
      comment: "Lovely Sunday lunch.",
      createTime: daysAgo(10),
      updateTime: daysAgo(10),
      ...overrides,
    }
  }

  function ingest(fixture: Fixture, payload: Payload) {
    return runtime.begin(async (sql: TransactionSql) => {
      await sql`
        select set_config('app.organisation_id', ${fixture.organisationId}, true)
      `
      return upsertGoogleReview(
        sql,
        fixture.organisationId,
        fixture.linked,
        payload
      )
    }) as Promise<string | null>
  }

  async function incidentsFor(fixture: Fixture, reviewId: string) {
    return admin<
      {
        id: string
        status: string
        locationId: string | null
        summary: Record<string, unknown>
      }[]
    >`
      select id::text as id, status, location_id::text as "locationId", summary
      from notification_incident
      where organisation_id = ${fixture.organisationId}
        and kind = 'low_rating_review'
        and subject_id = ${reviewId}
    `
  }

  async function deliveriesFor(incidentId: string) {
    return admin<{ recipient: string; status: string; channel: string }[]>`
      select recipient_user_id::text as recipient, status, channel
      from notification_delivery
      where incident_id = ${incidentId}
    `
  }

  it("announces a stored 5-star review edited to 2 stars days later", async () => {
    const fixture = await createFixture()
    const original = providerReview(fixture)
    const reviewId = await ingest(fixture, original)
    expect(reviewId).toBeTruthy()
    expect(await incidentsFor(fixture, reviewId!)).toEqual([])

    const editedDown = {
      ...original,
      starRating: "TWO",
      comment: "Went back and it was awful.",
      updateTime: new Date().toISOString(),
    }
    expect(await ingest(fixture, editedDown)).toBe(reviewId)

    const incidents = await incidentsFor(fixture, reviewId!)
    expect(incidents).toHaveLength(1)
    expect(incidents[0].status).toBe("resolved")
    expect(incidents[0].locationId).toBe(fixture.linked.locationId)
    expect(incidents[0].summary).toMatchObject({
      rating: 2,
      edited: true,
      previousRating: 5,
    })
    expect(typeof incidents[0].summary.title).toBe("string")
    expect(JSON.stringify(incidents[0].summary)).not.toContain("awful")
    const deliveries = await deliveriesFor(incidents[0].id)
    expect(deliveries).toEqual([
      { recipient: fixture.userId, status: "pending", channel: "email" },
    ])

    // The same payload again, and a further edit down: still one incident.
    await ingest(fixture, editedDown)
    await ingest(fixture, {
      ...editedDown,
      starRating: "ONE",
      updateTime: new Date(Date.now() + 1000).toISOString(),
    })
    // Back up and down again: announced once, ever.
    await ingest(fixture, {
      ...editedDown,
      starRating: "FIVE",
      updateTime: new Date(Date.now() + 2000).toISOString(),
    })
    await ingest(fixture, {
      ...editedDown,
      starRating: "ONE",
      comment: "Still awful.",
      updateTime: new Date(Date.now() + 3000).toISOString(),
    })
    const after = await incidentsFor(fixture, reviewId!)
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(incidents[0].id)
    expect(await deliveriesFor(incidents[0].id)).toHaveLength(1)
  })

  it("raises nothing for an edit that does not drop to 3 stars or fewer", async () => {
    const fixture = await createFixture()
    const four = providerReview(fixture, { starRating: "FOUR" })
    const fourId = await ingest(fixture, four)
    await ingest(fixture, {
      ...four,
      starRating: "FIVE",
      updateTime: new Date().toISOString(),
    })
    expect(await incidentsFor(fixture, fourId!)).toEqual([])

    const three = providerReview(fixture, { starRating: "THREE" })
    const threeId = await ingest(fixture, three)
    await ingest(fixture, {
      ...three,
      starRating: "TWO",
      updateTime: new Date().toISOString(),
    })
    expect(await incidentsFor(fixture, threeId!)).toEqual([])
  })

  it("ignores a drop Google dated more than 7 days ago", async () => {
    const fixture = await createFixture()
    const original = providerReview(fixture, {
      createTime: daysAgo(60),
      updateTime: daysAgo(60),
    })
    const reviewId = await ingest(fixture, original)
    await ingest(fixture, {
      ...original,
      starRating: "TWO",
      updateTime: daysAgo(30),
    })
    const [stored] = await admin<{ rating: number }[]>`
      select star_rating as rating from review where id = ${reviewId}
    `
    expect(stored.rating).toBe(2)
    expect(await incidentsFor(fixture, reviewId!)).toEqual([])
  })

  it("leaves a brand-new low review to the health scan", async () => {
    const fixture = await createFixture()
    const reviewId = await ingest(
      fixture,
      providerReview(fixture, {
        starRating: "TWO",
        createTime: new Date().toISOString(),
        updateTime: new Date().toISOString(),
      })
    )
    expect(reviewId).toBeTruthy()
    expect(await incidentsFor(fixture, reviewId!)).toEqual([])
  })

  // S3: topics belong to the words; a reviewer who removes them leaves none.
  it("forgets a review's topics when the reviewer removes its text", async () => {
    const fixture = await createFixture()
    const original = providerReview(fixture)
    const reviewId = (await ingest(fixture, original))!
    await admin`
      insert into review_topic_classification (
        organisation_id, review_id, status, text_hash, model,
        review_update_time, classified_at
      ) values (
        ${fixture.organisationId}, ${reviewId}, 'classified',
        md5(${String(original.comment)}), 'test-model', now(), now()
      )
    `
    await admin`
      insert into review_topic (
        organisation_id, review_id, topic, sentiment, model, classified_at,
        review_update_time
      ) values (
        ${fixture.organisationId}, ${reviewId}, 'sunday_roast', 'positive',
        'test-model', now(), now()
      )
    `
    const topics = () => admin`
      select topic from review_topic where review_id = ${reviewId}
    `
    // A rating change that keeps the words keeps the topics.
    await ingest(fixture, {
      ...original,
      starRating: "FOUR",
      updateTime: new Date().toISOString(),
    })
    expect(await topics()).toHaveLength(1)

    await ingest(fixture, {
      ...original,
      starRating: "FOUR",
      comment: undefined,
      updateTime: new Date(Date.now() + 1000).toISOString(),
    })
    expect(await topics()).toHaveLength(0)
    expect(
      await admin`
        select 1 from review_topic_classification where review_id = ${reviewId}
      `
    ).toHaveLength(0)
  })
})
