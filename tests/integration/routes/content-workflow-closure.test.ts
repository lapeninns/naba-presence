import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
  seedMemberUser,
} from "../helpers/tenant"

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip

/** WP9 content-workflow gaps closed in the 2026-09-30 audit, through real routes. */
describeDatabase("content workflow closure", { timeout: 45_000 }, () => {
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
      GBP_MEDIA_ENABLED: "true",
      PUBLISH_ENABLED: "true",
    })
  })
  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })
  beforeEach(() => google.reset())

  async function tenant() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const api = (path: string, init: RequestInit = {}, cookie = owner.cookie) =>
      fetch(`${server.baseUrl}/api/locations/${linked.locationId}${path}`, {
        ...init,
        headers: {
          cookie,
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
      })
    const draft = async () => {
      const response = await api("/posts", {
        method: "POST",
        body: JSON.stringify({
          topicType: "STANDARD",
          languageCode: "en-GB",
          summary: "Quiz night",
          media: [],
        }),
      })
      expect(response.status).toBe(201)
      return (await response.json()).post.id as string
    }
    return {
      owner,
      connection,
      linked,
      api,
      draft,
      parent: `${connection.googleAccountName}/${linked.googleLocationName}`,
    }
  }

  it("keeps stored posts when Google's post list is cut short", async () => {
    const t = await tenant()
    await admin`insert into gbp_local_post (organisation_id, location_id, external_location_id, topic_type, language_code, summary, media, status, google_post_name, created_by)
      values (${t.owner.organisationId}, ${t.linked.locationId}, ${t.linked.externalLocationId}, 'STANDARD', 'en-GB', 'Live post', '[]'::jsonb, 'published', ${`${t.parent}/localPosts/live`}, ${t.owner.userId})`
    google.respond({ method: "GET", pathIncludes: "/localPosts" }, () => ({
      status: 200,
      json: { localPosts: [], nextPageToken: "same" },
    }))
    const list = await t.api("/posts")
    expect(list.status).toBe(200)
    expect((await list.json()).reconciliationError).toBe("google_posts_incomplete")
    const [row] =
      await admin`select status from gbp_local_post where google_post_name = ${`${t.parent}/localPosts/live`}`
    expect(row.status).toBe("published")
  })

  it("applies the two-person policy to publishers and refuses to approve a post not awaiting approval", async () => {
    const t = await tenant()
    const post = await t.draft()
    const early = await t.api(`/posts/${post}/approval`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve" }),
    })
    expect(early.status).toBe(409)
    expect(await early.json()).toMatchObject({ error: "approval_not_pending" })
    await admin`update organisation set require_two_person_approval = true where id = ${t.owner.organisationId}`
    const publish = await t.api(`/posts/${post}/publish`, {
      method: "POST",
      body: "{}",
    })
    expect(publish.status).toBe(202)
    expect(await publish.json()).toEqual({ status: "awaiting_approval" })
    const self = await t.api(`/posts/${post}/approval`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve" }),
    })
    expect(self.status).toBe(403)
    expect(await self.json()).toMatchObject({
      error: "second_approver_required",
    })
    expect(google.calls.filter((call) => call.method === "POST")).toHaveLength(
      0
    )
    const manager = await seedMemberUser(admin, {
      organisationId: t.owner.organisationId,
      canPublish: true,
    })
    await admin`update member set role = 'admin' where user_id = ${manager.userId}`
    google.respond({ method: "POST", pathIncludes: "/localPosts" }, (call) => ({
      status: 200,
      json: {
        ...(call.body as object),
        name: `${t.parent}/localPosts/approved`,
        state: "LIVE",
      },
    }))
    google.respond(
      { method: "GET", pathIncludes: "/localPosts/approved" },
      () => ({
        status: 200,
        json: { name: `${t.parent}/localPosts/approved`, state: "LIVE" },
      })
    )
    const approved = await t.api(
      `/posts/${post}/approval`,
      { method: "POST", body: JSON.stringify({ decision: "approve" }) },
      manager.cookie
    )
    expect(approved.status, await approved.clone().text()).toBe(200)
    expect(google.calls.filter((call) => call.method === "POST")).toHaveLength(
      1
    )
  })

  it("refuses an edit made against an older version of the post", async () => {
    const t = await tenant(),
      post = await t.draft()
    const [row] = await admin<
      { updatedAt: Date }[]
    >`select updated_at as "updatedAt" from gbp_local_post where id = ${post}`
    const loaded = new Date(row.updatedAt).toISOString()
    const body = {
      topicType: "STANDARD",
      languageCode: "en-GB",
      summary: "Quiz night moved",
      media: [],
    }
    expect(
      (
        await t.api(`/posts/${post}`, {
          method: "PATCH",
          body: JSON.stringify({ ...body, expectedUpdatedAt: loaded }),
        })
      ).status
    ).toBe(200)
    const stale = await t.api(`/posts/${post}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...body,
        summary: "Overwrite",
        expectedUpdatedAt: loaded,
      }),
    })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: "post_changed" })
    const [after] =
      await admin`select summary from gbp_local_post where id = ${post}`
    expect(after.summary).toBe("Quiz night moved")
  })

  it("treats a post already gone from Google as deleted instead of failing the retry", async () => {
    const t = await tenant()
    const name = `${t.parent}/localPosts/gone`
    const [post] = await admin<
      { id: string }[]
    >`insert into gbp_local_post (organisation_id, location_id, external_location_id, topic_type, language_code, summary, media, status, google_post_name, created_by)
      values (${t.owner.organisationId}, ${t.linked.locationId}, ${t.linked.externalLocationId}, 'STANDARD', 'en-GB', 'Gone', '[]'::jsonb, 'published', ${name}, ${t.owner.userId}) returning id::text as id`
    google.respond(
      { method: "DELETE", pathIncludes: "/localPosts/gone" },
      () => ({ status: 404, json: { error: { status: "NOT_FOUND" } } })
    )
    const removed = await t.api(`/posts/${post.id}`, { method: "DELETE" })
    expect(removed.status, await removed.clone().text()).toBe(200)
    const [row] =
      await admin`select status from gbp_local_post where id = ${post.id}`
    expect(row.status).toBe("deleted")
  })

  it("returns the first upload when a lost response is retried with the same intent", async () => {
    const t = await tenant()
    let created = 0
    google.respond({ method: "GET", pathIncludes: "/media?" }, () => ({
      status: 200,
      json: { mediaItems: [] },
    }))
    google.respond({ method: "GET", pathIncludes: "/media/customers" }, () => ({
      status: 200,
      json: { mediaItems: [] },
    }))
    google.respond({ method: "POST", pathIncludes: "/media" }, (call) => {
      created += 1
      return {
        status: 200,
        json: {
          name: `${t.parent}/media/m${created}`,
          ...(call.body as object),
          googleUrl: "https://google.example/m.jpg",
        },
      }
    })
    google.respond({ method: "GET", pathIncludes: "/media/m" }, () => ({
      status: 200,
      json: {
        name: `${t.parent}/media/m1`,
        mediaFormat: "PHOTO",
        locationAssociation: { category: "FOOD_AND_DRINK" },
        googleUrl: "https://google.example/m.jpg",
      },
    }))
    const body = JSON.stringify({
      confirmation: "create_google_media",
      mediaFormat: "PHOTO",
      category: "FOOD_AND_DRINK",
      sourceUrl: "https://images.example.com/dish.jpg",
    })
    const intent = crypto.randomUUID()
    const first = await t.api("/media", {
      method: "POST",
      body,
      headers: { "idempotency-key": intent },
    })
    expect(first.status, await first.clone().text()).toBe(201)
    const retry = await t.api("/media", {
      method: "POST",
      body,
      headers: { "idempotency-key": intent },
    })
    expect(retry.status).toBe(201)
    expect(await retry.json()).toMatchObject({ idempotent: true })
    expect(created).toBe(1)
    const deliberate = await t.api("/media", {
      method: "POST",
      body,
      headers: { "idempotency-key": crypto.randomUUID() },
    })
    expect(deliberate.status).toBe(201)
    expect(created).toBe(2)
  })
})
