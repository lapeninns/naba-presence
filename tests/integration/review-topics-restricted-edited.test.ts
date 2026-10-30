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
type Label = { topic: string; sentiment: string }
type Usage = { inputTokens: number | null; outputTokens: number | null }
type Fixture = {
  organisationId: string
  userId: string
  linked: LinkedLocation
}

const DAY_MS = 86_400_000
const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString()

const REVIEW_TAG =
  /<review id="(\d+)" stars="([^"]*)">\n([\s\S]*?)\n<\/review>/g

const NEGATIVE_SERVICE: Label[] = [{ topic: "service", sentiment: "negative" }]

/** A fake model: every review it is sent is about poor service. */
function fakeClassifier() {
  const prompts: string[] = []
  const classifier = async (prompt: string) => {
    prompts.push(prompt)
    const results = [...prompt.matchAll(REVIEW_TAG)].map((match) => ({
      id: Number(match[1]),
      topics: NEGATIVE_SERVICE,
    }))
    const usage: Usage = { inputTokens: 100, outputTokens: 10 }
    return { value: { results }, usage }
  }
  return { classifier, prompts }
}

// S3, Codex review of the review-topics PR:
// - a review whose processing a fulfilled restriction request stopped keeps
//   its text, but is never claimed or sent to the provider, and its labels
//   stop counting in the report and the topic alert;
// - when Google supplies an edited text, the review's old labels stop
//   counting (and it shows as pending) until it is classified again, while a
//   review whose text retention redacted keeps its labels.
describeDatabase("review topics: restricted and edited reviews", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  let upsertGoogleReview: typeof import("@/lib/server/reviews").upsertGoogleReview
  let loadReviewTopicReport: typeof import("@/lib/server/review-topics").loadReviewTopicReport
  let reviewTopicSpikeFindings: typeof import("@/lib/server/review-topics-alerts").reviewTopicSpikeFindings
  let job: typeof import("@/lib/server/review-topics-job")
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, { max: 1 })
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL!
    process.env.NEXTAUTH_SECRET = "topic-restrict-test-session-secret-32-chars"
    process.env.TOKEN_ENCRYPTION_KEY =
      "topic-restrict-test-token-key-32-characters"
    process.env.CRON_SECRET = "topic-restrict-test-cron-secret"
    // Never a real provider: every run below injects a fake classifier.
    delete process.env.OPENAI_API_KEY
    ;({ upsertGoogleReview } = await import("@/lib/server/reviews"))
    ;({ loadReviewTopicReport } = await import("@/lib/server/review-topics"))
    ;({ reviewTopicSpikeFindings } =
      await import("@/lib/server/review-topics-alerts"))
    job = await import("@/lib/server/review-topics-job")
  })

  afterAll(async () => {
    await destroyTenants(admin, organisations)
    await runtime.end()
    await admin.end()
  })

  /** One linked listing with the feature on and no reviews yet. */
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
    // Only the reviews each test ingests.
    await admin`delete from review where id = ${seed.reviewId}`
    await admin`
      insert into organisation_feature (organisation_id, feature, enabled)
      values (${owner.organisationId}, 'review_topics', true)
    `
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

  function providerReview(fixture: Fixture, comment: string): Payload {
    const name = `${fixture.linked.googleAccountName}/${fixture.linked.googleLocationName}/reviews/${randomUUID()}`
    return {
      name,
      reviewId: name.split("/").at(-1),
      reviewer: { displayName: "Provider reviewer" },
      starRating: "ONE",
      comment,
      createTime: daysAgo(2),
      updateTime: daysAgo(2),
    }
  }

  function tenant<T>(
    fixture: Fixture,
    fn: (sql: TransactionSql) => Promise<T>
  ): Promise<T> {
    return runtime.begin(async (sql: TransactionSql) => {
      await sql`
        select set_config('app.organisation_id', ${fixture.organisationId}, true)
      `
      return fn(sql)
    }) as Promise<T>
  }

  async function ingest(fixture: Fixture, payload: Payload) {
    const id = await tenant(fixture, (sql) =>
      upsertGoogleReview(sql, fixture.organisationId, fixture.linked, payload)
    )
    expect(id).toBeTruthy()
    return id!
  }

  function classify(fixture: Fixture, classifier = fakeClassifier()) {
    return job.classifyOrganisationReviews(fixture.organisationId, {
      deadline: Date.now() + 120_000,
      leaseSeconds: 180,
      classifier: classifier.classifier,
    })
  }

  function report(fixture: Fixture) {
    return tenant(fixture, (sql) =>
      loadReviewTopicReport(
        sql,
        {
          role: "owner",
          userId: fixture.userId,
          organisationId: fixture.organisationId,
        },
        {}
      )
    )
  }

  function findings(fixture: Fixture) {
    return tenant(fixture, (sql) =>
      reviewTopicSpikeFindings(sql, fixture.organisationId)
    )
  }

  async function dueOrganisations() {
    const rows = await admin<{ organisationId: string }[]>`
      select organisation_id::text as "organisationId"
      from review_topic_due_organisations(
        1000, ${job.REVIEW_TOPIC_MAX_ATTEMPTS}
      )
    `
    return rows.map((row) => row.organisationId)
  }

  async function statusOf(reviewId: string) {
    const [row] = await admin<{ status: string }[]>`
      select status from review_topic_classification
      where review_id = ${reviewId}
    `
    return row?.status
  }

  /** As the privacy route does when it fulfils a restriction request. */
  async function restrict(reviewId: string) {
    await admin`
      update review set restricted_at = coalesce(restricted_at, now())
      where id = ${reviewId}
    `
  }

  /** Three negative 'service' reviews, classified: a spike. */
  async function classifiedSpike(fixture: Fixture) {
    const payloads: Payload[] = []
    const ids: string[] = []
    for (let n = 0; n < 3; n += 1) {
      const payload = providerReview(
        fixture,
        `Ignored by staff ${randomUUID()}`
      )
      payloads.push(payload)
      ids.push(await ingest(fixture, payload))
    }
    const outcome = await classify(fixture)
    expect(outcome).toMatchObject({ classified: 3, calls: 1 })
    expect(await findings(fixture)).toHaveLength(1)
    return { payloads, ids }
  }

  const service = (scope: { topics: { topic: string; mentions: number }[] }) =>
    scope.topics.find((line) => line.topic === "service")?.mentions ?? 0

  it("never claims or sends a restricted review, and the tick does not visit its organisation for it", async () => {
    const fixture = await createFixture()
    const secret = `Restricted words ${randomUUID()}`
    const restrictedId = await ingest(fixture, providerReview(fixture, secret))
    await restrict(restrictedId)

    expect(await dueOrganisations()).not.toContain(fixture.organisationId)
    const fake = fakeClassifier()
    const outcome = await classify(fixture, fake)

    expect(outcome).toEqual({
      classified: 0,
      failed: 0,
      calls: 0,
      stopped: "nothing_due",
    })
    expect(fake.prompts).toHaveLength(0)
    expect(await statusOf(restrictedId)).toBeUndefined()
    const usage = await admin`
      select 1 from ai_usage where organisation_id = ${fixture.organisationId}
    `
    expect(usage).toHaveLength(0)

    // Beside a live review: only the live one is sent.
    const live = `Live words ${randomUUID()}`
    const liveId = await ingest(fixture, providerReview(fixture, live))
    expect(await dueOrganisations()).toContain(fixture.organisationId)
    const next = await classify(fixture, fake)
    expect(next).toMatchObject({ classified: 1, calls: 1 })
    expect(fake.prompts).toHaveLength(1)
    expect(fake.prompts[0]).toContain(live)
    expect(fake.prompts[0]).not.toContain(secret)
    expect(await statusOf(liveId)).toBe("classified")
    expect(await statusOf(restrictedId)).toBeUndefined()
  })

  it("stops counting a restricted review's labels in the report and the alert", async () => {
    const fixture = await createFixture()
    const { ids } = await classifiedSpike(fixture)
    const before = await report(fixture)
    expect(before.group.classifiedReviews).toBe(3)
    expect(service(before.group)).toBe(3)

    await restrict(ids[0])

    const after = await report(fixture)
    expect(after.group.classifiedReviews).toBe(2)
    expect(service(after.group)).toBe(2)
    // Not waiting for the classifier either: it never will be.
    expect(after.pendingReviews).toBe(0)
    // Two negative mentions are below the rule's minimum.
    expect(await findings(fixture)).toEqual([])
  })

  it("stops counting an edited review's old labels until it is classified again", async () => {
    const fixture = await createFixture()
    const { payloads, ids } = await classifiedSpike(fixture)

    // Google serves the same review with new words.
    const edited = `Edited: the manager apologised ${randomUUID()}`
    await ingest(fixture, {
      ...payloads[0],
      comment: edited,
      updateTime: new Date().toISOString(),
    })

    expect(await statusOf(ids[0])).toBe("pending")
    const stale = await report(fixture)
    expect(stale.group.classifiedReviews).toBe(2)
    expect(service(stale.group)).toBe(2)
    expect(stale.pendingReviews).toBe(1)
    expect(await findings(fixture)).toEqual([])

    // A re-sync of an unchanged review leaves its answer alone.
    await ingest(fixture, {
      ...payloads[1],
      starRating: "TWO",
      updateTime: new Date().toISOString(),
    })
    expect(await statusOf(ids[1])).toBe("classified")

    const fake = fakeClassifier()
    const outcome = await classify(fixture, fake)
    expect(outcome).toMatchObject({ classified: 1, calls: 1 })
    expect(fake.prompts[0]).toContain(edited)
    expect(await statusOf(ids[0])).toBe("classified")
    const fresh = await report(fixture)
    expect(fresh.group.classifiedReviews).toBe(3)
    expect(service(fresh.group)).toBe(3)
    expect(fresh.pendingReviews).toBe(0)
    expect(await findings(fixture)).toHaveLength(1)
  })

  it("keeps counting the labels of a review whose text retention redacted", async () => {
    const fixture = await createFixture()
    const { payloads, ids } = await classifiedSpike(fixture)

    // As the retention purge does (lib/server/retention/purge.ts).
    await admin`
      update review
      set review_text = null, reviewer_display_name = null,
        reviewer_profile_photo_url = null, raw_payload = null
      where id = ${ids[0]}
    `

    expect(await statusOf(ids[0])).toBe("classified")
    const redacted = await report(fixture)
    expect(redacted.group.classifiedReviews).toBe(3)
    expect(service(redacted.group)).toBe(3)
    expect(redacted.pendingReviews).toBe(0)
    expect(await findings(fixture)).toHaveLength(1)

    // The next sync restores the same words: still the same answer, and
    // nothing to send again.
    await ingest(fixture, payloads[0])
    expect(await statusOf(ids[0])).toBe("classified")
    const fake = fakeClassifier()
    expect(await classify(fixture, fake)).toMatchObject({ calls: 0 })
    expect(fake.prompts).toHaveLength(0)
    expect(service((await report(fixture)).group)).toBe(3)
  })

  it("drops a redacted review's labels when the reviewer removes the comment on Google", async () => {
    const fixture = await createFixture()
    const { payloads, ids } = await classifiedSpike(fixture)

    // Retention redacted our copy first (lib/server/retention/purge.ts).
    await admin`
      update review
      set review_text = null, reviewer_display_name = null,
        reviewer_profile_photo_url = null, raw_payload = null
      where id = ${ids[0]}
    `
    expect(await statusOf(ids[0])).toBe("classified")

    // Then Google serves the review with no comment at all.
    await ingest(fixture, {
      ...payloads[0],
      comment: undefined,
      updateTime: new Date().toISOString(),
    })

    expect(await statusOf(ids[0])).toBeUndefined()
    const after = await report(fixture)
    expect(after.group.classifiedReviews).toBe(2)
    expect(service(after.group)).toBe(2)
    expect(after.pendingReviews).toBe(0)
    expect(await findings(fixture)).toEqual([])
  })
})
