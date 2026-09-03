import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { reapStrandedLocalPosts } from "@/lib/server/posts"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
  seedLinkedReview,
  seedMemberUser,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("Local Posts CRUD", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    // The reaper runs as the application does, under enforced row-level
    // security, so the test drives it through the runtime role rather than
    // the RLS-bypassing admin connection.
    runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      GBP_POSTS_ENABLED: "true",
      PUBLISH_ENABLED: "true",
    })
  })

  // Each case registers its own provider behaviour and counts its own calls.
  beforeEach(() => google.reset())

  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await runtime.end()
    await admin.end()
  })

  /** An owner, a Google connection and a location linked to it. */
  async function linkedTenant() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    return {
      owner,
      linked,
      postName: (suffix: string) =>
        `${connection.googleAccountName}/${linked.googleLocationName}/localPosts/${suffix}`,
    }
  }

  async function createDraft(
    cookie: string,
    locationId: string,
    summary: string
  ) {
    const created = await fetch(
      `${server.baseUrl}/api/locations/${locationId}/posts`,
      {
        method: "POST",
        headers: jsonHeaders(cookie),
        body: JSON.stringify(standardPost(summary)),
      }
    )
    expect(created.status, await created.clone().text()).toBe(201)
    return (await created.json()).post.id as string
  }

  function publish(cookie: string, locationId: string, postId: string) {
    return fetch(
      `${server.baseUrl}/api/locations/${locationId}/posts/${postId}/publish`,
      { method: "POST", headers: jsonHeaders(cookie), body: "{}" }
    )
  }

  function createCalls() {
    return google.calls.filter(
      (call) => call.method === "POST" && call.path.includes("/localPosts")
    )
  }

  function storedPosts(locationId: string) {
    return admin<
      {
        id: string
        status: string
        googlePostName: string | null
        lastErrorCode: string | null
        summary: string
      }[]
    >`
      select id::text as id, status, google_post_name as "googlePostName",
        last_error_code as "lastErrorCode", summary
      from gbp_local_post
      where location_id = ${locationId}
      order by created_at
    `
  }

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
    google.respond({ method: "POST", pathIncludes: "/localPosts" }, (call) => {
      providerVisible = true
      providerPost = { ...providerPost, ...(call.body as object) }
      return { status: 200, json: providerPost }
    })
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
    google.respond({ method: "GET", pathIncludes: "/localPosts?" }, () => ({
      status: 200,
      json: { localPosts: providerVisible ? [providerPost] : [] },
    }))

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

    const beforePublish = await listPosts(
      server.baseUrl,
      owner.cookie,
      linked.locationId
    )
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
    expect(
      (await listPosts(server.baseUrl, owner.cookie, linked.locationId))[0]
    ).toMatchObject({
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
    expect(
      await listPosts(server.baseUrl, owner.cookie, linked.locationId)
    ).toEqual([])

    const [attempts] = await admin<{ count: number }[]>`
      select count(*)::integer as count
      from gbp_local_post_attempt
      where organisation_id = ${owner.organisationId}
    `
    expect(attempts.count).toBe(3)
  })

  // The idempotency key used to carry the per-request id, so two clicks on
  // Publish computed two different keys, both claimed the post and Google
  // ended up holding the same update twice.
  it("lets only one of two concurrent publishes reach Google", async () => {
    const { owner, linked, postName } = await linkedTenant()
    const name = postName("concurrent")
    let live: Record<string, unknown> | null = null
    google.respond({ method: "POST", pathIncludes: "/localPosts" }, (call) => {
      live = { name, state: "LIVE", ...(call.body as object) }
      // Hold the provider call open so the second request arrives while the
      // first still owns the publish claim.
      return { status: 200, json: live, delayMs: 500 }
    })
    google.respond(
      { method: "GET", pathIncludes: "/localPosts/concurrent" },
      () => ({
        status: 200,
        json: live ?? {},
      })
    )
    google.respond({ method: "GET", pathIncludes: "/localPosts?" }, () => ({
      status: 200,
      json: { localPosts: live ? [live] : [] },
    }))

    const postId = await createDraft(
      owner.cookie,
      linked.locationId,
      "Two clicks"
    )
    const [first, second] = await Promise.all([
      publish(owner.cookie, linked.locationId, postId),
      publish(owner.cookie, linked.locationId, postId),
    ])
    const bodies = [await first.clone().json(), await second.clone().json()]
    expect(
      [first.status, second.status].sort(),
      JSON.stringify(bodies)
    ).toEqual([200, 409])
    const refused = bodies.find((body) => "error" in body) as { error: string }
    expect(refused.error).toBe("post_publish_in_progress")

    expect(createCalls()).toHaveLength(1)
    const rows = await storedPosts(linked.locationId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: "published", googlePostName: name })
  })

  // An ambiguous create used to settle 'ambiguous' with no Google name, and
  // the tab offered Publish on exactly that status - a blind second create.
  it("resolves an ambiguous create by reading Google, not by creating again", async () => {
    const { owner, linked, postName } = await linkedTenant()
    const name = postName("ambiguous-resolved")
    const live = {
      name,
      topicType: "STANDARD",
      languageCode: "en-GB",
      summary: "Bank holiday hours",
      state: "LIVE",
      searchUrl: "https://example.test/ambiguous",
    }
    // The create landed at Google; only the response was lost.
    google.respond({ method: "POST", pathIncludes: "/localPosts" }, () => ({
      status: 504,
      json: {},
    }))
    google.respond({ method: "GET", pathIncludes: "/localPosts?" }, () => ({
      status: 200,
      json: { localPosts: [live] },
    }))

    const postId = await createDraft(
      owner.cookie,
      linked.locationId,
      "Bank holiday hours"
    )
    const response = await publish(owner.cookie, linked.locationId, postId)
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({
      status: "published",
      googlePostName: name,
    })
    expect(createCalls()).toHaveLength(1)

    const posts = await listPosts(
      server.baseUrl,
      owner.cookie,
      linked.locationId
    )
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({
      id: postId,
      status: "published",
      googlePostName: name,
    })
  })

  // When Google cannot be read either, the row stays honestly unknown - and
  // the next read must adopt the live post rather than insert a second row.
  it("parks an unreadable ambiguous create and adopts the live post on the next read", async () => {
    const { owner, linked, postName } = await linkedTenant()
    const name = postName("ambiguous-parked")
    const live = {
      name,
      topicType: "STANDARD",
      languageCode: "en-GB",
      summary: "Late opening",
      state: "LIVE",
      searchUrl: "https://example.test/parked",
    }
    let listReadable = false
    google.respond({ method: "POST", pathIncludes: "/localPosts" }, () => ({
      status: 504,
      json: {},
    }))
    google.respond({ method: "GET", pathIncludes: "/localPosts?" }, () =>
      listReadable
        ? { status: 200, json: { localPosts: [live] } }
        : { status: 403, json: {} }
    )

    const postId = await createDraft(
      owner.cookie,
      linked.locationId,
      "Late opening"
    )
    const failed = await publish(owner.cookie, linked.locationId, postId)
    expect(failed.status, await failed.clone().text()).toBe(403)
    const [parked] = await storedPosts(linked.locationId)
    expect(parked).toMatchObject({ status: "ambiguous", googlePostName: null })

    listReadable = true
    const posts = await listPosts(
      server.baseUrl,
      owner.cookie,
      linked.locationId
    )
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({
      id: postId,
      status: "published",
      googlePostName: name,
    })
    expect(createCalls()).toHaveLength(1)
  })

  // A killed instance leaves the row at 'publishing'. Without the lease the
  // `status <> 'publishing'` claim would make that post unpublishable for
  // good, so the reaper and the claim have to work together.
  it("reclaims a publish left in flight and lets the post be published again", async () => {
    const { owner, linked, postName } = await linkedTenant()
    const name = postName("reclaimed")
    let live: Record<string, unknown> | null = null
    google.respond({ method: "POST", pathIncludes: "/localPosts" }, (call) => {
      live = { name, state: "LIVE", ...(call.body as object) }
      return { status: 200, json: live }
    })
    google.respond(
      { method: "GET", pathIncludes: "/localPosts/reclaimed" },
      () => ({
        status: 200,
        json: live ?? {},
      })
    )
    google.respond({ method: "GET", pathIncludes: "/localPosts?" }, () => ({
      status: 200,
      json: { localPosts: live ? [live] : [] },
    }))

    const postId = await createDraft(
      owner.cookie,
      linked.locationId,
      "Interrupted"
    )
    // Exactly what an instance killed between the claim and the settle leaves
    // behind: the post holding the claim and the attempt still in flight.
    await admin`
      update gbp_local_post
      set status = 'publishing',
        publish_lease_expires_at = now() - interval '1 minute'
      where id = ${postId}
    `
    await admin`
      insert into gbp_local_post_attempt (
        organisation_id, post_id, actor_user_id, operation, status,
        idempotency_key, intended_payload, started_at
      ) values (
        ${owner.organisationId}, ${postId}, ${owner.userId}, 'create',
        'started', ${randomUUID()},
        ${admin.json({
          topicType: "STANDARD",
          languageCode: "en-GB",
          summary: "Interrupted",
        })},
        now() - interval '10 minutes'
      )
    `

    // (1) The cron sweep parks the row without any provider call.
    const reaped = await runtime.begin(async (sql) => {
      await sql`select set_config('app.organisation_id', ${owner.organisationId}, true)`
      return reapStrandedLocalPosts(sql)
    })
    expect(reaped.count).toBe(1)
    const [parked] = await storedPosts(linked.locationId)
    expect(parked).toMatchObject({
      status: "ambiguous",
      lastErrorCode: "publish_lease_expired",
      googlePostName: null,
    })
    const [attempt] = await admin<{ status: string }[]>`
      select status from gbp_local_post_attempt where post_id = ${postId}
    `
    expect(attempt.status).toBe("ambiguous")

    // (2) Google's list says nothing was published, so the row is safe to
    // publish again.
    const afterRead = await listPosts(
      server.baseUrl,
      owner.cookie,
      linked.locationId
    )
    expect(afterRead[0]).toMatchObject({
      status: "failed",
      lastErrorCode: "google_post_not_published",
    })

    // (3) And it is: the claim was released, so this is not a permanent 409.
    const republished = await publish(owner.cookie, linked.locationId, postId)
    expect(republished.status, await republished.clone().text()).toBe(200)
    expect(await republished.json()).toMatchObject({
      status: "published",
      googlePostName: name,
    })
    const rows = await storedPosts(linked.locationId)
    expect(rows).toHaveLength(1)
  })

  // Reconciliation used to overwrite content and status from Google on every
  // read, so an approval request against a live post vanished before the
  // approver ever saw it.
  it("keeps a non-publisher's edit and approval request through reconciliation", async () => {
    const { owner, linked, postName } = await linkedTenant()
    const name = postName("approval")
    let live: Record<string, unknown> | null = null
    google.respond({ method: "POST", pathIncludes: "/localPosts" }, (call) => {
      live = { name, state: "LIVE", ...(call.body as object) }
      return { status: 200, json: live }
    })
    google.respond(
      { method: "GET", pathIncludes: "/localPosts/approval" },
      () => ({
        status: 200,
        json: live ?? {},
      })
    )
    google.respond({ method: "GET", pathIncludes: "/localPosts?" }, () => ({
      status: 200,
      json: { localPosts: live ? [live] : [] },
    }))
    const member = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      role: "member",
      assignLocationId: linked.locationId,
    })

    const postId = await createDraft(
      owner.cookie,
      linked.locationId,
      "Original hours"
    )
    expect(
      (await publish(owner.cookie, linked.locationId, postId)).status
    ).toBe(200)

    // The member may edit the location but not publish it, so editing a live
    // post asks for approval instead of writing to Google.
    const edited = await fetch(
      `${server.baseUrl}/api/locations/${linked.locationId}/posts/${postId}`,
      {
        method: "PATCH",
        headers: jsonHeaders(member.cookie),
        body: JSON.stringify(standardPost("Corrected hours")),
      }
    )
    expect(edited.status, await edited.clone().text()).toBe(200)
    expect(await edited.json()).toEqual({ status: "awaiting_approval" })
    // Google still holds the old text; the approver must see the new one.
    expect(google.calls.filter((call) => call.method === "PATCH")).toHaveLength(
      0
    )

    const posts = await listPosts(
      server.baseUrl,
      owner.cookie,
      linked.locationId
    )
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({
      id: postId,
      status: "awaiting_approval",
      summary: "Corrected hours",
      googlePostName: name,
    })

    const audits = await admin<{ action: string; requestId: string | null }[]>`
      select action, request_id as "requestId"
      from audit_log
      where organisation_id = ${owner.organisationId}
      order by created_at
    `
    expect(audits.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "post.draft.created",
        "post.published",
        "post.approval.requested",
      ])
    )
    // Every row carries the request that wrote it (never a fresh UUID).
    expect(audits.every((row) => Boolean(row.requestId))).toBe(true)
  })
})

function standardPost(summary: string) {
  return {
    topicType: "STANDARD",
    languageCode: "en-GB",
    summary,
    callToAction: {
      actionType: "LEARN_MORE",
      url: "https://example.test/menu",
    },
    media: [],
  }
}

function jsonHeaders(cookie: string) {
  return { cookie, "content-type": "application/json" }
}

async function listPosts(baseUrl: string, cookie: string, locationId: string) {
  const response = await fetch(`${baseUrl}/api/locations/${locationId}/posts`, {
    headers: { cookie },
  })
  expect(response.status, await response.clone().text()).toBe(200)
  return (await response.json()).posts as Array<Record<string, unknown>>
}
