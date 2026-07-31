import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("Local Posts CRUD", () => {
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
      PUBLISH_ENABLED: "true",
    })
  })

  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("creates a draft, publishes, updates with a mask, and deletes", async () => {
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
    const postName = `${connection.googleAccountName}/${linked.googleLocationName}/localPosts/post-1`
    let providerPost: Record<string, unknown> = {
      name: postName,
      topicType: "STANDARD",
      summary: "Summer menu",
      state: "LIVE",
      searchUrl: "https://example.test/google-post",
      createTime: "2026-07-31T09:00:00Z",
      updateTime: "2026-07-31T09:00:00Z",
    }
    let providerVisible = false
    google.respond(
      { method: "POST", pathIncludes: "/localPosts" },
      (call) => {
        providerVisible = true
        providerPost = { ...providerPost, ...(call.body as object) }
        return { status: 200, json: providerPost }
      }
    )
    google.respond(
      { method: "GET", pathIncludes: "/localPosts/post-1" },
      () => ({ status: 200, json: providerPost })
    )
    google.respond(
      { method: "PATCH", pathIncludes: "/localPosts/post-1" },
      (call) => {
        providerPost = {
          ...providerPost,
          ...(call.body as object),
          updateTime: "2026-07-31T10:00:00Z",
        }
        return { status: 200, json: providerPost }
      }
    )
    google.respond(
      { method: "DELETE", pathIncludes: "/localPosts/post-1" },
      () => {
        providerVisible = false
        return { status: 200, json: {} }
      }
    )
    google.respond(
      { method: "GET", pathIncludes: "/localPosts?" },
      () => ({ status: 200, json: { localPosts: providerVisible ? [providerPost] : [] } })
    )

    const created = await fetch(
      `${server.baseUrl}/api/locations/${linked.locationId}/posts`,
      {
        method: "POST",
        headers: jsonHeaders(owner.cookie),
        body: JSON.stringify(standardPost("Summer menu")),
      }
    )
    expect(created.status, await created.clone().text()).toBe(201)
    const postId = (await created.json()).post.id as string

    const beforePublish = await listPosts(server.baseUrl, owner.cookie, linked.locationId)
    expect(beforePublish).toMatchObject([
      { id: postId, status: "draft", summary: "Summer menu" },
    ])

    const published = await fetch(
      `${server.baseUrl}/api/locations/${linked.locationId}/posts/${postId}/publish`,
      { method: "POST", headers: jsonHeaders(owner.cookie), body: "{}" }
    )
    expect(published.status, await published.clone().text()).toBe(200)
    expect(await published.json()).toMatchObject({
      status: "published",
      googlePostName: postName,
    })
    expect((await listPosts(server.baseUrl, owner.cookie, linked.locationId))[0]).toMatchObject({
      status: "published",
      googleState: "LIVE",
      googleSearchUrl: "https://example.test/google-post",
    })

    const updated = await fetch(
      `${server.baseUrl}/api/locations/${linked.locationId}/posts/${postId}`,
      {
        method: "PATCH",
        headers: jsonHeaders(owner.cookie),
        body: JSON.stringify(standardPost("Updated summer menu")),
      }
    )
    expect(updated.status, await updated.clone().text()).toBe(200)
    const patchCall = google.calls.find((call) => call.method === "PATCH")
    expect(patchCall?.path).toContain("updateMask=")

    const removed = await fetch(
      `${server.baseUrl}/api/locations/${linked.locationId}/posts/${postId}`,
      { method: "DELETE", headers: { cookie: owner.cookie } }
    )
    expect(removed.status, await removed.clone().text()).toBe(200)
    expect(await listPosts(server.baseUrl, owner.cookie, linked.locationId)).toEqual([])

    const [attempts] = await admin<{ count: number }[]>`
      select count(*)::integer as count
      from gbp_local_post_attempt
      where organisation_id = ${owner.organisationId}
    `
    expect(attempts.count).toBe(3)
  })
})

function standardPost(summary: string) {
  return {
    topicType: "STANDARD",
    languageCode: "en-GB",
    summary,
    callToAction: { actionType: "LEARN_MORE", url: "https://example.test/menu" },
    media: [],
  }
}

function jsonHeaders(cookie: string) {
  return { cookie, "content-type": "application/json" }
}

async function listPosts(baseUrl: string, cookie: string, locationId: string) {
  const response = await fetch(
    `${baseUrl}/api/locations/${locationId}/posts`,
    { headers: { cookie } }
  )
  expect(response.status, await response.clone().text()).toBe(200)
  return (await response.json()).posts as Array<Record<string, unknown>>
}
