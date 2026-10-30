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

type Label = { topic: string; sentiment: string }
type Usage = { inputTokens: number | null; outputTokens: number | null }
type Classifier = (
  prompt: string,
  options: { deadline: number }
) => Promise<{ value: unknown; usage: Usage }>

type JobModule = typeof import("@/lib/server/review-topics-job")

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex")

const REVIEW_TAG =
  /<review id="(\d+)" stars="([^"]*)">\n([\s\S]*?)\n<\/review>/g

/** The reviews a prompt carries, in order: its 1-based id, stars and text. */
function promptReviews(prompt: string) {
  return [...prompt.matchAll(REVIEW_TAG)].map((match) => ({
    id: Number(match[1]),
    stars: match[2],
    text: match[3],
  }))
}

/**
 * A fake model. `answerFor` returns the topics for a review text, or
 * undefined to leave the review out of the answer.
 */
function fakeClassifier(
  answerFor: (text: string) => unknown,
  usage: Usage = { inputTokens: 321, outputTokens: 45 }
) {
  const prompts: string[] = []
  const classifier: Classifier = async (prompt) => {
    prompts.push(prompt)
    const results: { id: number; topics: unknown }[] = []
    for (const review of promptReviews(prompt)) {
      const topics = answerFor(review.text)
      if (topics !== undefined) results.push({ id: review.id, topics })
    }
    return { value: { results }, usage }
  }
  return { classifier, prompts }
}

const SERVICE_POSITIVE: Label[] = [{ topic: "service", sentiment: "positive" }]

describeDatabase("review topic classification job", () => {
  let admin: ReturnType<typeof postgres>
  let job: JobModule
  let ApiError: typeof import("@/lib/server/http").ApiError
  let AiOutputError: typeof import("@/lib/server/ai").AiOutputError
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL!
    process.env.NEXTAUTH_SECRET = "review-topics-test-session-secret-32-chars"
    process.env.TOKEN_ENCRYPTION_KEY =
      "review-topics-test-token-key-32-characters"
    process.env.CRON_SECRET = "review-topics-test-cron-secret"
    // Never a real provider: every call below injects a fake classifier.
    delete process.env.OPENAI_API_KEY
    job = await import("@/lib/server/review-topics-job")
    ;({ ApiError } = await import("@/lib/server/http"))
    ;({ AiOutputError } = await import("@/lib/server/ai"))
  })

  afterAll(async () => {
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function createOrganisation(options: { feature?: boolean } = {}) {
    const tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const venue = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    if (options.feature ?? true) await setFeature(tenant.organisationId, true)
    return { organisationId: tenant.organisationId, ...venue }
  }

  async function setFeature(organisationId: string, enabled: boolean) {
    await admin`
      insert into organisation_feature (organisation_id, feature, enabled)
      values (${organisationId}, 'review_topics', ${enabled})
      on conflict (organisation_id, feature) do update set enabled = excluded.enabled
    `
  }

  async function insertReview(
    venue: {
      organisationId: string
      locationId: string
      externalLocationId: string
    },
    input: {
      text: string | null
      rating?: number | null
      displayName?: string
      ageMinutes?: number
      deleted?: boolean
      erased?: boolean
    }
  ) {
    const id = randomUUID()
    const name = `accounts/a/locations/l/reviews/${id}`
    await admin`
      insert into review (
        id, organisation_id, location_id, external_location_id,
        google_review_name_ciphertext, google_review_name_hash,
        google_review_id_ciphertext, google_review_id_hash,
        reviewer_display_name, reviewer_is_anonymous, star_rating, review_text,
        detected_language_code, language_confidence, has_media,
        create_time, update_time, content_hash, workflow_status, raw_payload,
        provider_deleted_at, erased_at
      ) values (
        ${id}, ${venue.organisationId}, ${venue.locationId},
        ${venue.externalLocationId},
        ${Buffer.from(name)}, ${sha256(`name-${id}`)},
        ${Buffer.from(id)}, ${sha256(`id-${id}`)},
        ${input.displayName ?? "Topic reviewer"}, false,
        ${input.rating === undefined ? 4 : input.rating}, ${input.text},
        'en', 0.9, false,
        now() - make_interval(mins => ${input.ageMinutes ?? 60}),
        now() - make_interval(mins => ${input.ageMinutes ?? 60}),
        ${sha256(`content-${id}`)}, 'new', '{}'::jsonb,
        ${input.deleted ? new Date() : null},
        ${input.erased ? new Date() : null}
      )
    `
    return id
  }

  const options = (
    classifier: Classifier,
    extra: { maxReviews?: number } = {}
  ) => ({
    deadline: Date.now() + 120_000,
    leaseSeconds: 180,
    classifier,
    ...extra,
  })

  async function topicsOf(reviewId: string) {
    return admin<Label[]>`
      select topic, sentiment from review_topic
      where review_id = ${reviewId}
      order by topic
    `
  }

  async function classificationOf(reviewId: string) {
    const [row] = await admin<
      {
        status: string
        attempts: number
        claimId: string | null
        leaseExpiresAt: Date | null
        textHash: string
      }[]
    >`
      select status, attempts, claim_id::text as "claimId",
        lease_expires_at as "leaseExpiresAt", text_hash as "textHash"
      from review_topic_classification
      where review_id = ${reviewId}
    `
    return row
  }

  async function usageOf(organisationId: string) {
    return admin<
      {
        kind: string
        status: string
        credits: number
        inputTokens: number | null
        outputTokens: number | null
        requestId: string | null
      }[]
    >`
      select kind, status, credits, input_tokens as "inputTokens",
        output_tokens as "outputTokens", request_id as "requestId"
      from ai_usage
      where organisation_id = ${organisationId}
      order by created_at, id
    `
  }

  it("does nothing while the review_topics feature is off", async () => {
    const venue = await createOrganisation({ feature: false })
    const reviewId = await insertReview(venue, { text: "Great service." })
    const fake = fakeClassifier(() => SERVICE_POSITIVE)

    const outcome = await job.classifyOrganisationReviews(
      venue.organisationId,
      options(fake.classifier)
    )

    expect(outcome).toEqual({
      classified: 0,
      failed: 0,
      calls: 0,
      stopped: "feature_off",
    })
    expect(fake.prompts).toHaveLength(0)
    expect(await usageOf(venue.organisationId)).toEqual([])
    expect(await topicsOf(reviewId)).toEqual([])
    expect(await classificationOf(reviewId)).toBeUndefined()
    const due = await admin<{ organisationId: string }[]>`
      select organisation_id::text as "organisationId"
      from review_topic_due_organisations(1000, ${job.REVIEW_TOPIC_MAX_ATTEMPTS})
    `
    expect(due.map((row) => row.organisationId)).not.toContain(
      venue.organisationId
    )
  })

  it("sends only live text reviews, stores the answer and settles the call", async () => {
    const venue = await createOrganisation()
    const texts = {
      a: `The staff were wonderful ${randomUUID()}`,
      b: `Nothing much to say ${randomUUID()}`,
      c: `Hard to park nearby ${randomUUID()}`,
    }
    const reviewA = await insertReview(venue, {
      text: texts.a,
      rating: 5,
      displayName: "Zebedee Quuxworth",
    })
    const reviewB = await insertReview(venue, {
      text: texts.b,
      rating: null,
      displayName: "Zebedee Quuxworth",
    })
    const reviewC = await insertReview(venue, {
      text: texts.c,
      rating: 2,
      displayName: "Zebedee Quuxworth",
    })
    const noText = await insertReview(venue, { text: null, rating: 5 })
    const blank = await insertReview(venue, { text: "   ", rating: 5 })
    const deleted = await insertReview(venue, {
      text: `Deleted review ${randomUUID()}`,
      deleted: true,
    })
    const erased = await insertReview(venue, {
      text: `Erased review ${randomUUID()}`,
      erased: true,
    })
    const answers = new Map<string, Label[]>([
      [
        texts.a,
        [
          { topic: "service", sentiment: "positive" },
          { topic: "food_quality", sentiment: "negative" },
        ],
      ],
      [texts.b, []],
      [texts.c, [{ topic: "parking", sentiment: "neutral" }]],
    ])
    const fake = fakeClassifier((text) => answers.get(text), {
      inputTokens: 1234,
      outputTokens: 56,
    })

    const outcome = await job.classifyOrganisationReviews(
      venue.organisationId,
      options(fake.classifier)
    )

    expect(outcome).toEqual({
      classified: 3,
      failed: 0,
      calls: 1,
      stopped: "nothing_due",
    })
    expect(fake.prompts).toHaveLength(1)
    const prompt = fake.prompts[0]
    const sent = promptReviews(prompt)
    expect(sent.map((review) => review.text).sort()).toEqual(
      [texts.a, texts.b, texts.c].sort()
    )
    expect(sent.find((review) => review.text === texts.a)?.stars).toBe("5")
    expect(sent.find((review) => review.text === texts.b)?.stars).toBe("none")
    expect(sent.find((review) => review.text === texts.c)?.stars).toBe("2")
    expect(prompt).not.toContain("Zebedee")
    expect(prompt).not.toContain("Quuxworth")
    expect(prompt).not.toContain("Deleted review")
    expect(prompt).not.toContain("Erased review")

    expect(await topicsOf(reviewA)).toEqual([
      { topic: "food_quality", sentiment: "negative" },
      { topic: "service", sentiment: "positive" },
    ])
    expect(await topicsOf(reviewB)).toEqual([])
    expect(await topicsOf(reviewC)).toEqual([
      { topic: "parking", sentiment: "neutral" },
    ])
    for (const id of [reviewA, reviewB, reviewC]) {
      expect(await classificationOf(id)).toMatchObject({
        status: "classified",
        attempts: 0,
        claimId: null,
        leaseExpiresAt: null,
      })
    }
    const [hash] = await admin<{ matches: boolean }[]>`
      select c.text_hash = md5(r.review_text) as matches
      from review_topic_classification c join review r on r.id = c.review_id
      where c.review_id = ${reviewA}
    `
    expect(hash.matches).toBe(true)
    for (const id of [noText, blank, deleted, erased]) {
      expect(await classificationOf(id)).toBeUndefined()
      expect(await topicsOf(id)).toEqual([])
    }

    const usage = await usageOf(venue.organisationId)
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({
      kind: "classify",
      status: "settled",
      credits: 0,
      inputTokens: 1234,
      outputTokens: 56,
    })
    expect(usage[0].requestId).toMatch(/^topics:[0-9a-f-]{36}$/)
  })

  it("never stores a malformed answer and stops retrying at the attempt limit", async () => {
    const venue = await createOrganisation()
    const texts = {
      good: `Lovely beer garden ${randomUUID()}`,
      unknown: `Odd topic review ${randomUUID()}`,
      missing: `Unanswered review ${randomUUID()}`,
    }
    // Newest first is the prompt order; spread the ages so ids are stable.
    const good = await insertReview(venue, { text: texts.good, ageMinutes: 10 })
    const unknown = await insertReview(venue, {
      text: texts.unknown,
      ageMinutes: 20,
    })
    const missing = await insertReview(venue, {
      text: texts.missing,
      ageMinutes: 30,
    })
    const fake = fakeClassifier((text) => {
      if (text === texts.good)
        return [{ topic: "atmosphere", sentiment: "positive" }]
      if (text === texts.unknown)
        return [
          { topic: "service", sentiment: "positive" },
          { topic: "spaceships", sentiment: "negative" },
        ]
      return undefined
    })

    const first = await job.classifyOrganisationReviews(
      venue.organisationId,
      options(fake.classifier)
    )

    // One run is one attempt: a review the model got wrong is tried again
    // on a later tick, not straight away in the same run.
    expect(fake.prompts, "model calls in the first run").toHaveLength(1)
    expect(first).toMatchObject({ classified: 1, failed: 2, calls: 1 })
    expect(await topicsOf(good)).toEqual([
      { topic: "atmosphere", sentiment: "positive" },
    ])
    for (const id of [unknown, missing]) {
      expect(await topicsOf(id)).toEqual([])
      expect(await classificationOf(id)).toMatchObject({
        status: "failed",
        attempts: 1,
        claimId: null,
      })
    }
    const usage = await usageOf(venue.organisationId)
    expect(usage.map((row) => row.status)).toEqual(["settled"])
  })

  it("stores only the usable items of a malformed answer (one batch per run)", async () => {
    // maxReviews caps the run at this one batch, so the storage rules are
    // checked apart from how a run re-claims failed reviews.
    const venue = await createOrganisation()
    const texts = {
      good: `Lovely beer garden ${randomUUID()}`,
      unknown: `Odd topic review ${randomUUID()}`,
      missing: `Unanswered review ${randomUUID()}`,
    }
    const good = await insertReview(venue, { text: texts.good })
    const unknown = await insertReview(venue, { text: texts.unknown })
    const missing = await insertReview(venue, { text: texts.missing })
    const fake = fakeClassifier((text) => {
      if (text === texts.good)
        return [{ topic: "atmosphere", sentiment: "positive" }]
      if (text === texts.unknown)
        return [{ topic: "spaceships", sentiment: "negative" }]
      return undefined
    })

    const outcome = await job.classifyOrganisationReviews(
      venue.organisationId,
      options(fake.classifier, { maxReviews: 3 })
    )

    expect(outcome).toEqual({
      classified: 1,
      failed: 2,
      calls: 1,
      stopped: null,
    })
    expect(await topicsOf(good)).toEqual([
      { topic: "atmosphere", sentiment: "positive" },
    ])
    expect(await classificationOf(good)).toMatchObject({
      status: "classified",
    })
    for (const id of [unknown, missing]) {
      expect(await topicsOf(id)).toEqual([])
      expect(await classificationOf(id)).toMatchObject({
        status: "failed",
        attempts: 1,
        claimId: null,
      })
    }
    expect((await usageOf(venue.organisationId)).map((r) => r.status)).toEqual([
      "settled",
    ])
  })

  it("settles an AiOutputError call with its usage (one batch per run)", async () => {
    const venue = await createOrganisation()
    const ids = [
      await insertReview(venue, { text: `Unusable a ${randomUUID()}` }),
      await insertReview(venue, { text: `Unusable b ${randomUUID()}` }),
    ]
    const unusable: Classifier = async () => {
      throw new AiOutputError("unusable", { inputTokens: 70, outputTokens: 3 })
    }

    const outcome = await job.classifyOrganisationReviews(
      venue.organisationId,
      options(unusable, { maxReviews: 2 })
    )

    expect(outcome).toEqual({
      classified: 0,
      failed: 2,
      calls: 1,
      stopped: null,
    })
    const usage = await usageOf(venue.organisationId)
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({
      kind: "classify",
      status: "settled",
      credits: 0,
      inputTokens: 70,
      outputTokens: 3,
    })
    for (const id of ids) {
      expect(await classificationOf(id)).toMatchObject({
        status: "failed",
        attempts: 1,
        claimId: null,
      })
      expect(await topicsOf(id)).toEqual([])
    }
  })

  it("stops sending a review once it has failed REVIEW_TOPIC_MAX_ATTEMPTS times", async () => {
    const venue = await createOrganisation()
    const text = `Always unusable ${randomUUID()}`
    const reviewId = await insertReview(venue, { text })
    const fake = fakeClassifier(() => [
      { topic: "nope", sentiment: "positive" },
    ])

    for (let run = 0; run < job.REVIEW_TOPIC_MAX_ATTEMPTS + 2; run += 1) {
      await job.classifyOrganisationReviews(
        venue.organisationId,
        options(fake.classifier)
      )
    }

    const sends = fake.prompts.filter((prompt) => prompt.includes(text))
    expect(sends).toHaveLength(job.REVIEW_TOPIC_MAX_ATTEMPTS)
    expect(await classificationOf(reviewId)).toMatchObject({
      status: "failed",
      attempts: job.REVIEW_TOPIC_MAX_ATTEMPTS,
    })
    expect(await topicsOf(reviewId)).toEqual([])
    const outcome = await job.classifyOrganisationReviews(
      venue.organisationId,
      options(fake.classifier)
    )
    expect(outcome).toMatchObject({ calls: 0, stopped: "nothing_due" })
  })

  it("refunds the call and hands the claim back on a provider error", async () => {
    const venue = await createOrganisation()
    const ids = [
      await insertReview(venue, { text: `Provider fail one ${randomUUID()}` }),
      await insertReview(venue, { text: `Provider fail two ${randomUUID()}` }),
    ]
    let calls = 0
    const failing: Classifier = async () => {
      calls += 1
      throw new ApiError(502, "ai_provider_error", "x")
    }

    const outcome = await job.classifyOrganisationReviews(
      venue.organisationId,
      options(failing)
    )

    expect(outcome).toEqual({
      classified: 0,
      failed: 0,
      calls: 1,
      stopped: "provider_error",
    })
    expect(calls).toBe(1)
    const usage = await usageOf(venue.organisationId)
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({
      kind: "classify",
      status: "released",
      credits: 0,
    })
    for (const id of ids) {
      expect(await classificationOf(id)).toMatchObject({
        attempts: 0,
        claimId: null,
        leaseExpiresAt: null,
      })
      expect((await classificationOf(id)).status).not.toBe("classified")
      expect(await topicsOf(id)).toEqual([])
    }

    // The handed-back reviews are due again at once.
    const fake = fakeClassifier(() => SERVICE_POSITIVE)
    const retry = await job.classifyOrganisationReviews(
      venue.organisationId,
      options(fake.classifier)
    )
    expect(retry).toMatchObject({ classified: 2, calls: 1 })
  })

  it("settles a billed but unusable answer and counts one attempt", async () => {
    const venue = await createOrganisation()
    const ids = [
      await insertReview(venue, { text: `Unusable one ${randomUUID()}` }),
      await insertReview(venue, { text: `Unusable two ${randomUUID()}` }),
    ]
    let calls = 0
    const unusable: Classifier = async () => {
      calls += 1
      throw new AiOutputError(
        "unusable",
        { inputTokens: 700, outputTokens: 9 },
        "test-model"
      )
    }

    const outcome = await job.classifyOrganisationReviews(
      venue.organisationId,
      options(unusable)
    )

    expect(calls, "model calls in one run").toBe(1)
    expect(outcome).toMatchObject({ classified: 0, failed: 2, calls: 1 })
    const usage = await usageOf(venue.organisationId)
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({
      kind: "classify",
      status: "settled",
      credits: 0,
      inputTokens: 700,
      outputTokens: 9,
    })
    for (const id of ids) {
      expect(await classificationOf(id)).toMatchObject({
        status: "failed",
        attempts: 1,
        claimId: null,
      })
      expect(await topicsOf(id)).toEqual([])
    }
  })

  it("refuses an organisation whose billing is read-only", async () => {
    const venue = await createOrganisation()
    const reviewId = await insertReview(venue, {
      text: `Read only ${randomUUID()}`,
    })
    await admin`
      update organisation_billing
      set state = 'read_only', enforcement_enabled = true
      where organisation_id = ${venue.organisationId}
    `
    const fake = fakeClassifier(() => SERVICE_POSITIVE)

    const outcome = await job.classifyOrganisationReviews(
      venue.organisationId,
      options(fake.classifier)
    )

    expect(outcome).toEqual({
      classified: 0,
      failed: 0,
      calls: 0,
      stopped: "ai_unavailable",
    })
    expect(fake.prompts).toHaveLength(0)
    expect(await usageOf(venue.organisationId)).toEqual([])
    expect(await classificationOf(reviewId)).toBeUndefined()
  })

  it("reclassifies an edited review and leaves an unchanged one alone", async () => {
    const venue = await createOrganisation()
    const original = `Original text ${randomUUID()}`
    const untouched = `Untouched text ${randomUUID()}`
    const edited = `Edited: we waited an hour ${randomUUID()}`
    const editedId = await insertReview(venue, { text: original })
    const untouchedId = await insertReview(venue, { text: untouched })
    const answers = new Map<string, Label[]>([
      [original, [{ topic: "service", sentiment: "positive" }]],
      [untouched, [{ topic: "drinks", sentiment: "positive" }]],
      [
        edited,
        [
          { topic: "wait_time", sentiment: "negative" },
          { topic: "price_value", sentiment: "neutral" },
        ],
      ],
    ])
    const fake = fakeClassifier((text) => answers.get(text))

    await job.classifyOrganisationReviews(
      venue.organisationId,
      options(fake.classifier)
    )
    expect(await topicsOf(editedId)).toEqual([
      { topic: "service", sentiment: "positive" },
    ])

    await admin`
      update review set review_text = ${edited}, update_time = now()
      where id = ${editedId}
    `
    const outcome = await job.classifyOrganisationReviews(
      venue.organisationId,
      options(fake.classifier)
    )

    expect(outcome).toMatchObject({ classified: 1, calls: 1 })
    expect(fake.prompts).toHaveLength(2)
    expect(promptReviews(fake.prompts[1]).map((review) => review.text)).toEqual(
      [edited]
    )
    expect(await topicsOf(editedId)).toEqual([
      { topic: "price_value", sentiment: "neutral" },
      { topic: "wait_time", sentiment: "negative" },
    ])
    expect(await topicsOf(untouchedId)).toEqual([
      { topic: "drinks", sentiment: "positive" },
    ])
    expect(await classificationOf(editedId)).toMatchObject({
      status: "classified",
    })
  })

  it("classifies at most REVIEW_TOPIC_MAX_PER_RUN reviews per run, in batches", async () => {
    const venue = await createOrganisation()
    const ids: string[] = []
    for (let n = 0; n < 35; n += 1) {
      ids.push(
        await insertReview(venue, {
          text: `Batch review ${n} ${randomUUID()}`,
          ageMinutes: 10 + n,
        })
      )
    }
    const fake = fakeClassifier(() => SERVICE_POSITIVE)

    const outcome = await job.classifyOrganisationReviews(
      venue.organisationId,
      options(fake.classifier)
    )

    expect(job.REVIEW_TOPIC_MAX_PER_RUN).toBe(30)
    expect(job.REVIEW_TOPIC_BATCH_SIZE).toBe(10)
    expect(outcome).toEqual({
      classified: 30,
      failed: 0,
      calls: 3,
      stopped: null,
    })
    expect(fake.prompts).toHaveLength(3)
    for (const prompt of fake.prompts) {
      expect(promptReviews(prompt).length).toBeLessThanOrEqual(
        job.REVIEW_TOPIC_BATCH_SIZE
      )
    }
    const [counts] = await admin<{ classified: number; topics: number }[]>`
      select
        (select count(*)::int from review_topic_classification
          where organisation_id = ${venue.organisationId}
            and status = 'classified') as classified,
        (select count(*)::int from review_topic
          where organisation_id = ${venue.organisationId}) as topics
    `
    expect(counts).toEqual({ classified: 30, topics: 30 })
    // Newest first: the five oldest wait for the next run.
    for (const id of ids.slice(30)) {
      expect(await classificationOf(id)).toBeUndefined()
    }
    const usage = await usageOf(venue.organisationId)
    expect(usage.map((row) => row.status)).toEqual([
      "settled",
      "settled",
      "settled",
    ])

    const next = await job.classifyOrganisationReviews(
      venue.organisationId,
      options(fake.classifier)
    )
    expect(next).toMatchObject({ classified: 5, calls: 1 })
  })

  it("never touches another organisation's reviews", async () => {
    const a = await createOrganisation()
    const b = await createOrganisation()
    const aText = `Org A review ${randomUUID()}`
    const bText = `Org B review ${randomUUID()}`
    const aReview = await insertReview(a, { text: aText })
    const bReview = await insertReview(b, { text: bText })
    const fake = fakeClassifier(() => SERVICE_POSITIVE)

    const outcome = await job.classifyOrganisationReviews(
      a.organisationId,
      options(fake.classifier)
    )

    expect(outcome).toMatchObject({ classified: 1, calls: 1 })
    expect(fake.prompts.join("\n")).not.toContain(bText)
    expect(fake.prompts.join("\n")).toContain(aText)
    expect(await classificationOf(aReview)).toMatchObject({
      status: "classified",
    })
    expect(await classificationOf(bReview)).toBeUndefined()
    const [bRows] = await admin<{ classifications: number; topics: number }[]>`
      select
        (select count(*)::int from review_topic_classification
          where organisation_id = ${b.organisationId}) as classifications,
        (select count(*)::int from review_topic
          where organisation_id = ${b.organisationId}) as topics
    `
    expect(bRows).toEqual({ classifications: 0, topics: 0 })
    expect(await usageOf(b.organisationId)).toEqual([])
  })

  it("runs a tick across due organisations with an injected classifier", async () => {
    const venue = await createOrganisation()
    const off = await createOrganisation({ feature: false })
    const onReview = await insertReview(venue, {
      text: `Tick review ${randomUUID()}`,
    })
    const offReview = await insertReview(off, {
      text: `Tick review off ${randomUUID()}`,
    })
    const fake = fakeClassifier(() => SERVICE_POSITIVE)

    const summary = await job.runReviewTopicClassification({
      budgetMs: 60_000,
      requestId: `test-${randomUUID()}`,
      classifier: fake.classifier,
    })

    expect(summary.skipped).toBeUndefined()
    expect(summary.organisations).toBeGreaterThanOrEqual(1)
    expect(await classificationOf(onReview)).toMatchObject({
      status: "classified",
    })
    expect(await classificationOf(offReview)).toBeUndefined()
  })
})
