import { createHash, randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
} from "./helpers/tenant"

vi.mock("server-only", () => ({}))

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

type Venue = {
  organisationId: string
  userId: string
  locationId: string
  externalLocationId: string
}

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex")

const SECRET_TEXT = "the-waiter-ignored-us-secret-text"

describeDatabase("review topic negative-spike alerts", () => {
  let admin: ReturnType<typeof postgres>
  let evaluateReviewTopicAlerts: typeof import("@/lib/server/review-topics-alerts").evaluateReviewTopicAlerts
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL!
    process.env.NEXTAUTH_SECRET = "topic-alerts-test-session-secret-32-chars"
    process.env.TOKEN_ENCRYPTION_KEY =
      "topic-alerts-test-token-key-32-characters"
    process.env.CRON_SECRET = "topic-alerts-test-cron-secret"
    ;({ evaluateReviewTopicAlerts } =
      await import("@/lib/server/review-topics-alerts"))
  })

  afterAll(async () => {
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function createVenue(options: { feature?: boolean } = {}) {
    const tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const location = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    if (options.feature ?? true) await setFeature(tenant.organisationId, true)
    return {
      organisationId: tenant.organisationId,
      userId: tenant.userId,
      locationId: location.locationId,
      externalLocationId: location.externalLocationId,
    }
  }

  async function setFeature(organisationId: string, enabled: boolean) {
    await admin`
      insert into organisation_feature (organisation_id, feature, enabled)
      values (${organisationId}, 'review_topics', ${enabled})
      on conflict (organisation_id, feature) do update set enabled = excluded.enabled
    `
  }

  /** A classified review `daysAgo` old with one topic label. */
  async function seedMention(
    venue: Venue,
    input: { daysAgo: number; topic: string; sentiment: string }
  ) {
    const id = randomUUID()
    await admin`
      insert into review (
        id, organisation_id, location_id, external_location_id,
        google_review_name_ciphertext, google_review_name_hash,
        google_review_id_ciphertext, google_review_id_hash,
        reviewer_display_name, reviewer_is_anonymous, star_rating, review_text,
        detected_language_code, language_confidence, has_media,
        create_time, update_time, content_hash, workflow_status, raw_payload
      ) values (
        ${id}, ${venue.organisationId}, ${venue.locationId},
        ${venue.externalLocationId},
        ${Buffer.from(`reviews/${id}`)}, ${sha256(`name-${id}`)},
        ${Buffer.from(id)}, ${sha256(`id-${id}`)},
        'Spike reviewer', false,
        ${input.sentiment === "negative" ? 1 : 5},
        ${`${SECRET_TEXT} ${id}`},
        'en', 0.9, false,
        now() - make_interval(days => ${input.daysAgo}),
        now() - make_interval(days => ${input.daysAgo}),
        ${sha256(`content-${id}`)}, 'new', '{}'::jsonb
      )
    `
    await admin`
      insert into review_topic (
        organisation_id, review_id, topic, sentiment, model, classified_at,
        review_update_time
      ) values (
        ${venue.organisationId}, ${id}, ${input.topic}, ${input.sentiment},
        'test-model', now(), now() - make_interval(days => ${input.daysAgo})
      )
    `
    // Only labels of a current classification count.
    await admin`
      insert into review_topic_classification (
        organisation_id, review_id, status, text_hash, model,
        review_update_time, classified_at
      ) values (
        ${venue.organisationId}, ${id}, 'classified',
        md5(${`${SECRET_TEXT} ${id}`}), 'test-model',
        now() - make_interval(days => ${input.daysAgo}), now()
      )
    `
    return id
  }

  /** 10 positive 'service' mentions 30-80 days ago, plus `negatives` recent negative ones. */
  async function seedSpike(venue: Venue, negatives = 3) {
    for (let n = 0; n < 10; n += 1) {
      await seedMention(venue, {
        daysAgo: 30 + n * 5,
        topic: "service",
        sentiment: "positive",
      })
    }
    const ids: string[] = []
    for (let n = 0; n < negatives; n += 1) {
      ids.push(
        await seedMention(venue, {
          daysAgo: 1 + n,
          topic: "service",
          sentiment: "negative",
        })
      )
    }
    return ids
  }

  async function incidentsOf(organisationId: string) {
    return admin<
      {
        id: string
        status: string
        subjectId: string
        locationId: string | null
        summary: Record<string, unknown>
      }[]
    >`
      select id::text as id, status, subject_id as "subjectId",
        location_id::text as "locationId", summary
      from notification_incident
      where organisation_id = ${organisationId}
        and kind = 'review_topic_negative'
      order by opened_at
    `
  }

  async function deliveriesOf(incidentId: string) {
    return admin<{ recipient: string }[]>`
      select recipient_user_id::text as recipient
      from notification_delivery
      where incident_id = ${incidentId}
    `
  }

  it("opens one incident for a venue's negative spike, with counts only", async () => {
    const venue = await createVenue()
    await seedSpike(venue)

    const result = await evaluateReviewTopicAlerts(venue.organisationId)

    expect(result.opened).toBe(1)
    expect(result.resolved).toBe(0)
    const incidents = await incidentsOf(venue.organisationId)
    expect(incidents).toHaveLength(1)
    expect(incidents[0]).toMatchObject({
      status: "open",
      subjectId: `${venue.locationId}:service`,
      locationId: venue.locationId,
    })
    expect(incidents[0].summary).toMatchObject({
      topic: "service",
      recentNegative: 3,
      recentMentions: 3,
    })
    expect(JSON.stringify(incidents[0].summary)).not.toContain(SECRET_TEXT)
    expect(JSON.stringify(incidents[0].summary)).not.toContain("Spike reviewer")

    // Again: still one open incident, nothing new opened.
    const again = await evaluateReviewTopicAlerts(venue.organisationId)
    expect(again).toEqual({ opened: 0, resolved: 0, deliveriesQueued: 0 })
    expect(await incidentsOf(venue.organisationId)).toHaveLength(1)
  })

  it("queues an immediate delivery for the owner by default", async () => {
    const venue = await createVenue()
    await seedSpike(venue)

    const result = await evaluateReviewTopicAlerts(venue.organisationId)

    const [incident] = await incidentsOf(venue.organisationId)
    expect(incident).toBeDefined()
    expect(result.deliveriesQueued).toBe(1)
    expect(await deliveriesOf(incident.id)).toEqual([
      { recipient: venue.userId },
    ])
  })

  it("queues a delivery for an owner who opted in to immediate email", async () => {
    const venue = await createVenue()
    await admin`
      insert into notification_preference (
        organisation_id, user_id, event_kind, channel, mode
      ) values (
        ${venue.organisationId}, ${venue.userId}, 'review_topic_negative',
        'email', 'immediate'
      )
    `
    await seedSpike(venue)

    const result = await evaluateReviewTopicAlerts(venue.organisationId)

    const [incident] = await incidentsOf(venue.organisationId)
    expect(result.deliveriesQueued).toBe(1)
    expect(await deliveriesOf(incident.id)).toEqual([
      { recipient: venue.userId },
    ])
  })

  it("ignores labels of a review waiting to be classified again", async () => {
    const venue = await createVenue()
    const negatives = await seedSpike(venue)
    await admin`
      update review_topic_classification set status = 'pending'
      where review_id in ${admin(negatives)}
    `
    const result = await evaluateReviewTopicAlerts(venue.organisationId)
    expect(result.opened).toBe(0)
    expect(await incidentsOf(venue.organisationId)).toHaveLength(0)
  })

  it("raises nothing for two negative mentions", async () => {
    const venue = await createVenue()
    await seedSpike(venue, 2)

    const result = await evaluateReviewTopicAlerts(venue.organisationId)

    expect(result).toEqual({ opened: 0, resolved: 0, deliveriesQueued: 0 })
    expect(await incidentsOf(venue.organisationId)).toEqual([])
  })

  it("resolves the incident once the negative mentions are gone, and waits out a cooldown before raising it again", async () => {
    const venue = await createVenue()
    const negatives = await seedSpike(venue)
    await evaluateReviewTopicAlerts(venue.organisationId)
    expect((await incidentsOf(venue.organisationId))[0]?.status).toBe("open")

    await admin`
      update review_topic set sentiment = 'positive'
      where review_id in ${admin(negatives)}
    `
    const result = await evaluateReviewTopicAlerts(venue.organisationId)

    expect(result).toMatchObject({ opened: 0, resolved: 1 })
    const incidents = await incidentsOf(venue.organisationId)
    expect(incidents).toHaveLength(1)
    expect(incidents[0].status).toBe("resolved")

    // Within the cooldown a fresh spike raises nothing: no email per swing.
    const again = await seedSpike(venue)
    expect(await evaluateReviewTopicAlerts(venue.organisationId)).toMatchObject(
      { opened: 0, deliveriesQueued: 0 }
    )
    // Once it has passed, the spike is announced again, and a deleted label
    // resolves it the same way.
    await admin`
      update notification_incident
      set resolved_at = now() - interval '8 days'
      where organisation_id = ${venue.organisationId}
        and kind = 'review_topic_negative'
    `
    expect((await evaluateReviewTopicAlerts(venue.organisationId)).opened).toBe(
      1
    )
    await admin`delete from review_topic where review_id in ${admin(again)}`
    expect(
      (await evaluateReviewTopicAlerts(venue.organisationId)).resolved
    ).toBe(1)
    expect(
      (await incidentsOf(venue.organisationId)).map((row) => row.status)
    ).toEqual(["resolved", "resolved"])
  })

  it("opens nothing with the feature off, and resolves an open incident", async () => {
    const venue = await createVenue({ feature: false })
    await seedSpike(venue)

    expect(await evaluateReviewTopicAlerts(venue.organisationId)).toEqual({
      opened: 0,
      resolved: 0,
      deliveriesQueued: 0,
    })
    expect(await incidentsOf(venue.organisationId)).toEqual([])

    await setFeature(venue.organisationId, true)
    expect((await evaluateReviewTopicAlerts(venue.organisationId)).opened).toBe(
      1
    )
    await setFeature(venue.organisationId, false)
    const result = await evaluateReviewTopicAlerts(venue.organisationId)

    expect(result).toMatchObject({ opened: 0, resolved: 1 })
    expect(
      (await incidentsOf(venue.organisationId)).map((row) => row.status)
    ).toEqual(["resolved"])
  })

  it("never opens an incident in one organisation from another's data", async () => {
    const a = await createVenue()
    const b = await createVenue()
    await seedSpike(b)

    const result = await evaluateReviewTopicAlerts(a.organisationId)

    expect(result).toEqual({ opened: 0, resolved: 0, deliveriesQueued: 0 })
    expect(await incidentsOf(a.organisationId)).toEqual([])
    expect(await incidentsOf(b.organisationId)).toEqual([])

    expect((await evaluateReviewTopicAlerts(b.organisationId)).opened).toBe(1)
    expect(await incidentsOf(a.organisationId)).toEqual([])
    const [bIncident] = await incidentsOf(b.organisationId)
    expect(bIncident.subjectId).toBe(`${b.locationId}:service`)
    // A's run does not resolve B's open incident.
    await evaluateReviewTopicAlerts(a.organisationId)
    expect((await incidentsOf(b.organisationId))[0].status).toBe("open")
  })
})
