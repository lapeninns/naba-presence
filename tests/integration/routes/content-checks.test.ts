import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
  seedLinkedReview,
} from "../helpers/tenant"

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip

// HTTP requests exercise the runtime role and the final provider mutation gates.
// The admin connection only creates disposable fixtures and changes policy.
describeDatabase("Content checks at save and publish", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      GBP_POSTS_ENABLED: "true",
      GBP_PROFILE_WRITES_ENABLED: "true",
      PUBLISH_ENABLED: "true",
    })
  })
  beforeEach(() => google.reset())
  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function fixture() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      ...connection,
    })
    google.respond(
      { method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` },
      () => ({
        status: 200,
        json: {
          name: linked.googleLocationName,
          title: "Fixture Inn",
          profile: { description: "A welcoming village pub." },
        },
      })
    )
    const headers = { cookie: owner.cookie, "content-type": "application/json" }
    const root = `${server.baseUrl}/api/locations/${linked.locationId}`
    const savePost = (
      summary: string,
      contentWarningAcknowledgement?: string
    ) =>
      fetch(`${root}/posts`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          topicType: "STANDARD",
          languageCode: "en-GB",
          summary,
          media: [],
          contentWarningAcknowledgement,
        }),
      })
    return { owner, linked, headers, root, savePost }
  }

  it.each([
    ["phone number", "Call +44 1223 456789 to book.", "content_phone"],
    ["body URL", "See https://example.com/menu for the menu.", "content_url"],
    [
      "banned phrase",
      "Our valued customer offer starts today.",
      "banned_phrase",
    ],
  ])(
    "refuses a post containing a %s without a Google write",
    async (_label, summary, code) => {
      const f = await fixture()
      await admin`update organisation set banned_phrases = ARRAY['valued customer'] where id = ${f.owner.organisationId}`
      const response = await f.savePost(summary)
      expect(response.status, await response.clone().text()).toBe(422)
      expect(await response.json()).toMatchObject({
        error: "content_checks_failed",
        details: {
          reasons: expect.arrayContaining([
            expect.objectContaining({ code, severity: "fail" }),
          ]),
        },
      })
      expect(google.calls.filter((call) => call.method !== "GET")).toEqual([])
      const [{ count }] =
        await admin`select count(*)::int as count from gbp_local_post where organisation_id = ${f.owner.organisationId}`
      expect(count).toBe(0)
    }
  )

  it("requires acknowledgement of the exact warning and invalidates it after an edit", async () => {
    const f = await fixture()
    const summary = "Come and see our new menu!!!"
    const warned = await f.savePost(summary)
    expect(warned.status, await warned.clone().text()).toBe(409)
    const { details } = await warned.json()
    expect(details.reasons).toContainEqual(
      expect.objectContaining({ code: "content_punctuation", severity: "warn" })
    )
    expect(details.contentWarningAcknowledgement).toMatch(/^[a-f0-9]{64}$/)
    const changed = await f.savePost(
      "Come and see our new drinks!!!",
      details.contentWarningAcknowledgement
    )
    expect(changed.status).toBe(409)
    const saved = await f.savePost(
      summary,
      details.contentWarningAcknowledgement
    )
    expect(saved.status, await saved.clone().text()).toBe(201)
    const { post } = await saved.json()
    const [stored] =
      await admin`select content_warning_acknowledgement from gbp_local_post where id = ${post.id}`
    expect(stored.content_warning_acknowledgement).toBe(
      details.contentWarningAcknowledgement
    )
    expect(google.calls.filter((call) => call.method !== "GET")).toEqual([])
  })

  it("rechecks current organisation policy when a saved post is published", async () => {
    const f = await fixture()
    const saved = await f.savePost("Join us for our seasonal supper.")
    expect(saved.status, await saved.clone().text()).toBe(201)
    const { post } = await saved.json()
    await admin`update organisation set banned_phrases = ARRAY['seasonal supper'] where id = ${f.owner.organisationId}`
    const published = await fetch(`${f.root}/posts/${post.id}/publish`, {
      method: "POST",
      headers: f.headers,
      body: "{}",
    })
    expect(published.status, await published.clone().text()).toBe(422)
    expect(await published.json()).toMatchObject({
      error: "content_checks_failed",
    })
    expect(google.calls.filter((call) => call.method !== "GET")).toEqual([])
    const [stored] =
      await admin`select status from gbp_local_post where id = ${post.id}`
    expect(stored.status).toBe("draft")
  })

  it("checks a description at save and rechecks a saved description before publishing", async () => {
    const f = await fixture()
    const load = async () => {
      const response = await fetch(`${f.root}/profile`, { headers: f.headers })
      expect(response.status, await response.clone().text()).toBe(200)
      return (await response.json()).profile
    }
    const initial = await load()
    const save = (description: string, revision: string) =>
      fetch(`${f.root}/profile`, {
        method: "PUT",
        headers: f.headers,
        body: JSON.stringify({
          expectedCanonicalRevision: revision,
          values: { description },
        }),
      })
    const blocked = await save(
      "Book on https://example.com today.",
      initial.canonicalResource.revision
    )
    expect(blocked.status, await blocked.clone().text()).toBe(422)
    const saved = await save(
      "A village pub serving seasonal supper.",
      initial.canonicalResource.revision
    )
    expect(saved.status, await saved.clone().text()).toBe(200)
    const reviewed = await load()
    await admin`update organisation set banned_phrases = ARRAY['seasonal supper'] where id = ${f.owner.organisationId}`
    const published = await fetch(`${f.root}/profile`, {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({
        direction: "to_google",
        confirmation: "publish_nabapresence_profile_to_google",
        selectedFields: ["description"],
        expectedCanonicalRevision: reviewed.canonicalResource.revision,
        expectedCanonicalHash: reviewed.canonicalHash,
        expectedGoogleHash: reviewed.googleHash,
        confirmOverwriteGoogleChanges: false,
        confirmOverwriteCanonicalChanges: false,
      }),
    })
    expect(published.status, await published.clone().text()).toBe(422)
    expect(await published.json()).toMatchObject({
      error: "content_checks_failed",
    })
    expect(google.calls.filter((call) => call.method !== "GET")).toEqual([])
  })
  async function replyFixture(sameClient = true) {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const current = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      ...connection,
    })
    const previous = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      ...connection,
    })
    const [client] = await admin<
      { id: string }[]
    >`insert into client (organisation_id, name, slug) values (${owner.organisationId}, 'Client one', 'client-one') returning id::text as id`
    const [otherClient] = await admin<
      { id: string }[]
    >`insert into client (organisation_id, name, slug) values (${owner.organisationId}, 'Client two', 'client-two') returning id::text as id`
    await admin`update location set client_id = ${client.id} where id = ${current.locationId}`
    await admin`update location set client_id = ${sameClient ? client.id : otherClient.id} where id = ${previous.locationId}`
    const headers = { cookie: owner.cookie, "content-type": "application/json" }
    const saveReply = async (body?: string) => {
      const response = await fetch(
        `${server.baseUrl}/api/reviews/${current.reviewId}/drafts`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            tone: "warm_professional",
            ...(body ? { body } : {}),
          }),
        }
      )
      expect(response.status, await response.clone().text()).toBe(201)
      return response.json()
    }
    const previousReply = async (body: string) => {
      await admin`insert into review_reply (organisation_id, review_id, current_body, publish_status, google_reply_updated_at) values (${owner.organisationId}, ${previous.reviewId}, ${body}, 'published', now()) on conflict (organisation_id, review_id) do update set current_body = excluded.current_body, publish_status = 'published', google_reply_updated_at = now()`
    }
    return { owner, current, previous, headers, saveReply, previousReply }
  }

  it("compares published replies across the same client's venues", async () => {
    const f = await replyFixture()
    await f.previousReply(
      "Thank you for visiting. We enjoyed hearing about your evening with us."
    )
    const duplicate = await f.saveReply(
      "Thank you for visiting! We enjoyed hearing about your evening with us."
    )
    expect(duplicate.verification).toMatchObject({
      verdict: "fail",
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: "reply_duplicate" }),
      ]),
    })
    const sameOpening = await f.saveReply(
      "Thank you for visiting. Our kitchen team will be pleased that the Sunday lunch suited your family."
    )
    expect(sameOpening.verification).toMatchObject({
      verdict: "warn",
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: "reply_repeated_opening" }),
      ]),
    })
  })

  it("does not compare a different client's published replies", async () => {
    const f = await replyFixture(false)
    const body =
      "Thank you for visiting. We enjoyed hearing about your evening with us."
    await f.previousReply(body)
    const draft = await f.saveReply(body)
    expect(draft.verification.verdict).toBe("pass")
    expect(draft.verification.reasons).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "reply_duplicate" }),
      ])
    )
  })

  it("exempts generated rating-only templates while still checking human replies", async () => {
    const f = await replyFixture()
    await admin`update review set review_text = null where id = ${f.current.reviewId}`
    const first = await f.saveReply()
    await f.previousReply(first.body)
    const repeatedTemplate = await f.saveReply()
    expect(repeatedTemplate.verification.verdict).toBe("pass")
    const humanCopy = await f.saveReply(first.body)
    expect(humanCopy.verification).toMatchObject({
      verdict: "fail",
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: "reply_duplicate" }),
      ]),
    })
  })

  it("rechecks reply repetition at publish after another venue publishes", async () => {
    const f = await replyFixture()
    const body =
      "Thank you for visiting. Our kitchen team enjoyed preparing supper for you."
    const draft = await f.saveReply(body)
    expect(draft.verification.verdict).toBe("pass")
    await f.previousReply(body)
    const [review] = await admin<
      { updateTime: Date }[]
    >`select update_time as "updateTime" from review where id = ${f.current.reviewId}`
    const response = await fetch(
      `${server.baseUrl}/api/reviews/${f.current.reviewId}/publish`,
      {
        method: "POST",
        headers: f.headers,
        body: JSON.stringify({
          draftId: draft.draftId,
          expectedReviewUpdateTime: review.updateTime.toISOString(),
        }),
      }
    )
    expect(response.status, await response.clone().text()).toBe(409)
    expect(await response.json()).toMatchObject({
      error: "verification_failed",
      details: {
        reasons: expect.arrayContaining([
          expect.objectContaining({ code: "reply_duplicate" }),
        ]),
      },
    })
    expect(google.calls.filter((call) => call.method !== "GET")).toEqual([])
  })
})
