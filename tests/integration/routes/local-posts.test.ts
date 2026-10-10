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

  it("keeps content timestamps stable across reconciliation and local edits to rejected posts", async () => {
    const { owner, linked, postName } = await linkedTenant()
    const liveName = postName("content-time")
    const rejectedName = postName("rejected-time")
    const malformedName = postName("malformed-time")
    google.respond({ method: "GET", pathIncludes: "/localPosts" }, () => ({
      status: 200,
      json: { localPosts: [
        { name: liveName, topicType: "STANDARD", summary: "Provider content", state: "LIVE", createTime: "2026-08-01T09:00:00Z", updateTime: "2026-08-02T09:00:00Z" },
        { name: rejectedName, topicType: "STANDARD", summary: "Rejected content", state: "REJECTED", createTime: "2026-08-01T09:00:00Z", updateTime: "2026-09-01T09:00:00Z" },
        { name: malformedName, topicType: "STANDARD", summary: "Unknown date", state: "LIVE", createTime: "not-a-date", updateTime: "invalid" },
      ] },
    }))
    const first = await listPosts(server.baseUrl, owner.cookie, linked.locationId)
    expect(first.find((post) => post.googlePostName === liveName)).toMatchObject({ providerCreatedAt: "2026-08-01T09:00:00.000Z", providerUpdatedAt: "2026-08-02T09:00:00.000Z" })
    expect(first.find((post) => post.googlePostName === malformedName)).toMatchObject({ providerCreatedAt: null, providerUpdatedAt: null })
    const rejected = first.find((post) => post.googlePostName === rejectedName)
    expect(rejected?.localEditedAt).toBeNull()
    expect(first[0]?.googlePostName).toBe(rejectedName)
    const edit = await fetch(`${server.baseUrl}/api/locations/${linked.locationId}/posts/${rejected?.id}`, {
      method: "PATCH", headers: jsonHeaders(owner.cookie), body: JSON.stringify(standardPost("Edited local draft")),
    })
    expect(edit.status, await edit.clone().text()).toBe(200)
    const second = await listPosts(server.baseUrl, owner.cookie, linked.locationId)
    const draft = second.find((post) => post.id === rejected?.id)
    expect(draft).toMatchObject({ status: "draft", summary: "Edited local draft", localEditedAt: expect.any(String) })
    const third = await listPosts(server.baseUrl, owner.cookie, linked.locationId)
    expect(third.find((post) => post.id === rejected?.id)).toMatchObject({ status: "draft", summary: "Edited local draft", localEditedAt: draft?.localEditedAt })
    expect(third.find((post) => post.googlePostName === liveName)).toMatchObject({ providerUpdatedAt: "2026-08-02T09:00:00.000Z" })
    expect(third[0]?.id).toBe(rejected?.id)
    expect(third.at(-1)?.googlePostName).toBe(malformedName)
    expect(google.calls.every((call) => call.method === "GET")).toBe(true)
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
    google.respond({ method: "POST", pathIncludes: "/localPosts" }, (call) => {
      providerVisible = true
      providerPost = { ...providerPost, ...(call.body as object) }
      return { status: 200, json: providerPost }
    })
    google.respond(
      { method: "GET", pathIncludes: "/localPosts/post-1" },
      // Like Google: a deleted post reads as not found.
      () => providerVisible
        ? { status: 200, json: providerPost }
        : { status: 404, json: { error: { status: "NOT_FOUND" } } }
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

  // A post Google is still reviewing is not live. An unchanged re-publish
  // under a new intent is answered from the succeeded attempt, and its
  // receipt used to be settled confirmed_applied from the bare row status.
  it("records a re-publish of a post Google is still reviewing as awaiting confirmation", async () => {
    const { owner, linked, postName } = await linkedTenant()
    const name = postName("reviewing")
    let held: Record<string, unknown> = {}
    google.respond({ method: "POST", pathIncludes: "/localPosts" }, (call) => {
      held = { ...(call.body as object), name, state: "PROCESSING" }
      return { status: 200, json: held }
    })
    google.respond(
      { method: "PATCH", pathIncludes: "/localPosts/reviewing" },
      (call) => {
        held = { ...held, ...(call.body as object), state: "PROCESSING" }
        return { status: 200, json: held }
      }
    )
    google.respond(
      { method: "GET", pathIncludes: "/localPosts/reviewing" },
      () => ({ status: 200, json: held })
    )
    google.respond({ method: "GET", pathIncludes: "/localPosts?" }, () => ({
      status: 200,
      json: { localPosts: [held] },
    }))
    const postId = await createDraft(
      owner.cookie,
      linked.locationId,
      "Under review"
    )
    const publishUnder = (intentId: string) =>
      fetch(
        `${server.baseUrl}/api/locations/${linked.locationId}/posts/${postId}/publish`,
        {
          method: "POST",
          headers: {
            ...jsonHeaders(owner.cookie),
            "Idempotency-Key": intentId,
          },
          body: "{}",
        }
      )
    const receiptState = async (intentId: string) => {
      const [row] = await admin<{ state: string }[]>`
        select state from mutation_operation
        where organisation_id = ${owner.organisationId}
          and intent_id = ${intentId}
      `
      return row?.state
    }

    const created = randomUUID()
    const first = await publishUnder(created)
    expect(first.status, await first.clone().text()).toBe(200)
    expect(await receiptState(created)).toBe("awaiting_confirmation")
    // The first publish of a named post sends the update; the second one of
    // the same content is that update's succeeded attempt again.
    const updated = randomUUID()
    const second = await publishUnder(updated)
    expect(second.status, await second.clone().text()).toBe(200)
    expect(await receiptState(updated)).toBe("awaiting_confirmation")
    const patches = () =>
      google.calls.filter((call) => call.method === "PATCH").length
    const sentBefore = patches()

    const repeated = randomUUID()
    const third = await publishUnder(repeated)
    expect(third.status, await third.clone().text()).toBe(200)
    expect(await third.json()).toMatchObject({
      operation: { outcome: "awaiting_confirmation" },
    })
    expect(patches()).toBe(sentBefore)
    expect(await receiptState(repeated)).toBe("awaiting_confirmation")
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

  // The post's key moves with its content, so the attempt-level reconcile
  // cannot catch an ambiguous post whose payload changed. The publish route
  // refuses to send until Google's list has settled the post on the server.
  it("reads the list before publishing an ambiguous post and never creates when it matches", async () => {
    const { owner, linked, postName } = await linkedTenant()
    const name = postName("ambiguous-guarded")
    google.respond({ method: "POST", pathIncludes: "/localPosts" }, () => ({
      status: 200,
      json: { name: postName("duplicate"), state: "LIVE" },
    }))
    google.respond({ method: "GET", pathIncludes: "/localPosts?" }, () => ({
      status: 200,
      json: {
        localPosts: [
          {
            name,
            topicType: "STANDARD",
            languageCode: "en-GB",
            summary: "Quiz night",
            state: "LIVE",
          },
        ],
      },
    }))
    const postId = await createDraft(
      owner.cookie,
      linked.locationId,
      "Quiz night"
    )
    // What an unconfirmed create leaves: no Google name, status unknown, and
    // an ambiguous attempt under a key this publish will not derive (the
    // content was edited since, say), so only the post-level guard sees it.
    await admin`
      update gbp_local_post set status = 'ambiguous' where id = ${postId}
    `
    await admin`
      insert into gbp_local_post_attempt (
        organisation_id, post_id, actor_user_id, operation, status,
        idempotency_key, intended_payload, started_at, finished_at
      ) values (
        ${owner.organisationId}, ${postId}, ${owner.userId}, 'create',
        'ambiguous', ${randomUUID()},
        ${admin.json({
          topicType: "STANDARD",
          languageCode: "en-GB",
          summary: "Quiz night",
        })},
        now() - interval '1 minute', now()
      )
    `

    const response = await publish(owner.cookie, linked.locationId, postId)
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({
      status: "published",
      googlePostName: name,
    })
    expect(createCalls()).toHaveLength(0)
    const listCall = google.calls.findIndex(
      (call) => call.method === "GET" && call.path.includes("/localPosts?")
    )
    expect(listCall).toBeGreaterThanOrEqual(0)
    const rows = await storedPosts(linked.locationId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: "published", googlePostName: name })
    // The list settled the attempt too, so it is not read back again later.
    const [attempt] = await admin<{ status: string }[]>`
      select status from gbp_local_post_attempt where post_id = ${postId}
    `
    expect(attempt.status).toBe("succeeded")
  })

  it("publishes an ambiguous post once Google's list shows it never landed", async () => {
    const { owner, linked, postName } = await linkedTenant()
    const name = postName("ambiguous-absent")
    let live: Record<string, unknown> | null = null
    google.respond({ method: "POST", pathIncludes: "/localPosts" }, (call) => {
      live = { name, state: "LIVE", ...(call.body as object) }
      return { status: 200, json: live }
    })
    google.respond(
      { method: "GET", pathIncludes: "/localPosts/ambiguous-absent" },
      () => ({ status: 200, json: live ?? {} })
    )
    google.respond({ method: "GET", pathIncludes: "/localPosts?" }, () => ({
      status: 200,
      json: { localPosts: live ? [live] : [] },
    }))
    const postId = await createDraft(
      owner.cookie,
      linked.locationId,
      "Never landed"
    )
    await admin`
      update gbp_local_post set status = 'ambiguous' where id = ${postId}
    `
    const response = await publish(owner.cookie, linked.locationId, postId)
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({
      status: "published",
      googlePostName: name,
    })
    expect(createCalls()).toHaveLength(1)
  })

  it("refuses to publish an ambiguous post while Google's list cannot be read", async () => {
    const { owner, linked } = await linkedTenant()
    google.respond({ method: "GET", pathIncludes: "/localPosts?" }, () => ({
      status: 403,
      json: {},
    }))
    const postId = await createDraft(
      owner.cookie,
      linked.locationId,
      "Unreadable"
    )
    await admin`
      update gbp_local_post set status = 'ambiguous' where id = ${postId}
    `
    const response = await publish(owner.cookie, linked.locationId, postId)
    // The list read's own error, not a 409: the post stays `ambiguous`.
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe("google_api_error")
    expect(createCalls()).toHaveLength(0)
    const [row] = await storedPosts(linked.locationId)
    expect(row.status).toBe("ambiguous")
  })

  it("settles a delete Google answered with a 5xx by reading the list back", async () => {
    const { owner, linked, postName } = await linkedTenant()
    const gone = postName("delete-landed")
    const kept = postName("delete-refused")
    const listed = new Set([gone, kept])
    google.respond(
      { method: "DELETE", pathIncludes: "/localPosts/" },
      (call) => {
        // Google removes the first post but the answer is lost; the second it
        // never reaches.
        if (call.path.includes("delete-landed")) listed.delete(gone)
        return { status: 503, json: {} }
      }
    )
    google.respond({ method: "GET", pathIncludes: "/localPosts?" }, () => ({
      status: 200,
      json: {
        localPosts: [...listed].map((name) => ({
          name,
          topicType: "STANDARD",
          summary: name,
          state: "LIVE",
        })),
      },
    }))
    const remove = async (summary: string, name: string) => {
      const postId = await createDraft(owner.cookie, linked.locationId, summary)
      await admin`
        update gbp_local_post
        set status = 'published', google_post_name = ${name}
        where id = ${postId}
      `
      return fetch(
        `${server.baseUrl}/api/locations/${linked.locationId}/posts/${postId}`,
        { method: "DELETE", headers: { cookie: owner.cookie } }
      )
    }

    const landed = await remove("Landed", gone)
    expect(landed.status, await landed.clone().text()).toBe(200)
    const refused = await remove("Refused", kept)
    expect(refused.status).toBe(502)
    expect((await refused.json()).error).toBe("google_post_not_deleted")

    const attempts = await admin<{ status: string; code: string | null }[]>`
      select status, provider_error_code as code
      from gbp_local_post_attempt
      where organisation_id = ${owner.organisationId} and operation = 'delete'
      order by started_at
    `
    expect(attempts).toEqual([
      { status: "succeeded", code: null },
      { status: "failed", code: "google_post_not_deleted" },
    ])
  })

  // A listed name proves only that a post exists, never that a PATCH landed,
  // so an unconfirmed update is re-sent (a PATCH is idempotent) and Google's
  // copy never replaces the text that was not confirmed.
  it("re-sends an update Google answered ambiguously and keeps the edit through a list", async () => {
    const { owner, linked, postName } = await linkedTenant()
    const name = postName("ambiguous-update")
    let live: Record<string, unknown> | null = null
    let patchAnswer = 503
    google.respond({ method: "POST", pathIncludes: "/localPosts" }, (call) => {
      live = { name, state: "LIVE", ...(call.body as object) }
      return { status: 200, json: live }
    })
    google.respond(
      { method: "PATCH", pathIncludes: "/localPosts/ambiguous-update" },
      (call) => {
        if (patchAnswer !== 200) return { status: patchAnswer, json: {} }
        live = { ...live, ...(call.body as object) }
        return { status: 200, json: live }
      }
    )
    google.respond(
      { method: "GET", pathIncludes: "/localPosts/ambiguous-update" },
      () => ({ status: 200, json: live ?? {} })
    )
    google.respond({ method: "GET", pathIncludes: "/localPosts?" }, () => ({
      status: 200,
      json: { localPosts: live ? [live] : [] },
    }))
    const patchCalls = () =>
      google.calls.filter((call) => call.method === "PATCH")

    const postId = await createDraft(owner.cookie, linked.locationId, "First")
    const first = await publish(owner.cookie, linked.locationId, postId)
    expect(first.status, await first.clone().text()).toBe(200)

    // (1) The PATCH's answer is lost. The post exists at Google either way,
    // so reading it back proves nothing: the attempt fails, safe to resend.
    const edit = await fetch(
      `${server.baseUrl}/api/locations/${linked.locationId}/posts/${postId}`,
      {
        method: "PATCH",
        headers: jsonHeaders(owner.cookie),
        body: JSON.stringify(standardPost("Second")),
      }
    )
    expect(edit.status, await edit.clone().text()).toBe(502)
    expect((await edit.json()).error).toBe("google_post_update_unconfirmed")
    expect(patchCalls()).toHaveLength(1)

    // (2) A list does not mark the edit live or overwrite it with Google's copy.
    await listPosts(server.baseUrl, owner.cookie, linked.locationId)
    const [kept] = await storedPosts(linked.locationId)
    expect(kept).toMatchObject({
      status: "failed",
      summary: "Second",
      googlePostName: name,
      lastErrorCode: "google_post_update_unconfirmed",
    })

    // (3) Publishing again re-sends the PATCH instead of answering `published`
    // with nothing sent.
    patchAnswer = 200
    const resend = await publish(owner.cookie, linked.locationId, postId)
    expect(resend.status, await resend.clone().text()).toBe(200)
    expect(await resend.json()).toMatchObject({
      status: "published",
      googlePostName: name,
    })
    expect(patchCalls()).toHaveLength(2)
    expect(patchCalls()[1].body).toMatchObject({ summary: "Second" })
    expect(createCalls()).toHaveLength(1)
  })

  // The readback of an update compares content (lib/domain/readback/posts.ts),
  // not just that the post exists: Google answering the PATCH while still
  // holding the old text is an update that did not apply.
  it("fails an update whose readback still holds different content", async () => {
    const { owner, linked, postName } = await linkedTenant()
    const name = postName("divergent-update")
    let live: Record<string, unknown> | null = null
    google.respond({ method: "POST", pathIncludes: "/localPosts" }, (call) => {
      live = { name, state: "LIVE", ...(call.body as object) }
      return { status: 200, json: live }
    })
    // Google answers the PATCH 200 but keeps the old post.
    google.respond(
      { method: "PATCH", pathIncludes: "/localPosts/divergent-update" },
      () => ({ status: 200, json: live ?? {} })
    )
    google.respond(
      { method: "GET", pathIncludes: "/localPosts/divergent-update" },
      () => ({ status: 200, json: live ?? {} })
    )
    google.respond({ method: "GET", pathIncludes: "/localPosts?" }, () => ({
      status: 200,
      json: { localPosts: live ? [live] : [] },
    }))

    const postId = await createDraft(owner.cookie, linked.locationId, "First")
    const first = await publish(owner.cookie, linked.locationId, postId)
    expect(first.status, await first.clone().text()).toBe(200)

    const edit = await fetch(
      `${server.baseUrl}/api/locations/${linked.locationId}/posts/${postId}`,
      {
        method: "PATCH",
        headers: jsonHeaders(owner.cookie),
        body: JSON.stringify(standardPost("Second")),
      }
    )
    expect(edit.status, await edit.clone().text()).toBe(502)
    expect((await edit.json()).error).toBe("google_post_update_unconfirmed")
    const attempts = await admin<{ status: string; code: string | null }[]>`
      select status, provider_error_code as code
      from gbp_local_post_attempt
      where organisation_id = ${owner.organisationId}
      order by created_at
    `
    expect(attempts.map((attempt) => attempt.status)).toEqual([
      "succeeded",
      "failed",
    ])
    expect(createCalls()).toHaveLength(1)
  })

  it("re-sends an update whose readback failed rather than adopting the listed post", async () => {
    const { owner, linked, postName } = await linkedTenant()
    const name = postName("unread-update")
    let live: Record<string, unknown> = {
      name,
      topicType: "STANDARD",
      languageCode: "en-GB",
      summary: "Google copy",
      state: "LIVE",
    }
    let readable = false
    google.respond(
      { method: "PATCH", pathIncludes: "/localPosts/unread-update" },
      (call) => {
        live = { ...live, ...(call.body as object) }
        return { status: 200, json: live }
      }
    )
    google.respond(
      { method: "GET", pathIncludes: "/localPosts/unread-update" },
      // Not a 5xx: the read transport would back off and retry it.
      () => (readable ? { status: 200, json: live } : { status: 403, json: {} })
    )
    // Google's list still serves the old text (read-after-write lag).
    google.respond({ method: "GET", pathIncludes: "/localPosts?" }, () => ({
      status: 200,
      json: { localPosts: [{ ...live, summary: "Google copy" }] },
    }))

    const postId = await createDraft(owner.cookie, linked.locationId, "Mine")
    await admin`
      update gbp_local_post
      set status = 'published', google_post_name = ${name}
      where id = ${postId}
    `
    // (1) The PATCH lands but its readback cannot be read: the post and the
    // attempt (under the key the next publish derives) settle `ambiguous`.
    const first = await publish(owner.cookie, linked.locationId, postId)
    expect(first.status).not.toBe(200)
    const [parked] = await storedPosts(linked.locationId)
    expect(parked.status).toBe("ambiguous")

    // (2) The post-level guard reads the list, which lists the name: that is
    // not proof of the PATCH, so the post fails, the attempt-level reconcile
    // fails its row too, and the PATCH goes out again with the local text.
    readable = true
    const resend = await publish(owner.cookie, linked.locationId, postId)
    expect(resend.status, await resend.clone().text()).toBe(200)
    expect(await resend.json()).toMatchObject({ status: "published" })
    const patches = google.calls.filter((call) => call.method === "PATCH")
    expect(patches).toHaveLength(2)
    expect(patches[1].body).toMatchObject({ summary: "Mine" })
    const attempts = await admin<{ status: string }[]>`
      select status from gbp_local_post_attempt where post_id = ${postId}
    `
    expect(attempts).toEqual([{ status: "succeeded" }])
  })

  // An edit used to reset an unconfirmed create to 'draft', which moved its
  // key and skipped the publish guard: a second live post if the first landed.
  it("refuses to edit an unconfirmed create until Google's list settles it", async () => {
    const { owner, linked, postName } = await linkedTenant()
    const name = postName("ambiguous-edit")
    google.respond({ method: "POST", pathIncludes: "/localPosts" }, () => ({
      status: 200,
      json: { name: postName("duplicate"), state: "LIVE" },
    }))
    google.respond({ method: "GET", pathIncludes: "/localPosts?" }, () => ({
      status: 200,
      json: {
        localPosts: [
          {
            name,
            topicType: "STANDARD",
            languageCode: "en-GB",
            summary: "Before edit",
            state: "LIVE",
          },
        ],
      },
    }))
    const postId = await createDraft(
      owner.cookie,
      linked.locationId,
      "Before edit"
    )
    await admin`
      update gbp_local_post set status = 'ambiguous' where id = ${postId}
    `
    await admin`
      insert into gbp_local_post_attempt (
        organisation_id, post_id, actor_user_id, operation, status,
        idempotency_key, intended_payload, started_at, finished_at
      ) values (
        ${owner.organisationId}, ${postId}, ${owner.userId}, 'create',
        'ambiguous', ${randomUUID()},
        ${admin.json({
          topicType: "STANDARD",
          languageCode: "en-GB",
          summary: "Before edit",
        })},
        now() - interval '1 minute', now()
      )
    `

    const edit = await fetch(
      `${server.baseUrl}/api/locations/${linked.locationId}/posts/${postId}`,
      {
        method: "PATCH",
        headers: jsonHeaders(owner.cookie),
        body: JSON.stringify(standardPost("After edit")),
      }
    )
    expect(edit.status).toBe(409)
    expect((await edit.json()).error).toBe("post_publish_uncertain")
    const [unchanged] = await storedPosts(linked.locationId)
    expect(unchanged).toMatchObject({
      status: "ambiguous",
      summary: "Before edit",
    })

    const published = await publish(owner.cookie, linked.locationId, postId)
    expect(published.status, await published.clone().text()).toBe(200)
    expect(await published.json()).toMatchObject({
      status: "published",
      googlePostName: name,
    })
    expect(createCalls()).toHaveLength(0)
    expect(await storedPosts(linked.locationId)).toHaveLength(1)
  })

  it("takes a 2xx delete as Google's answer without reading the list", async () => {
    const { owner, linked, postName } = await linkedTenant()
    const name = postName("delete-clean")
    google.respond(
      { method: "DELETE", pathIncludes: "/localPosts/delete-clean" },
      () => ({ status: 200, json: {} })
    )
    // Were it read, this list would fail the delete that landed.
    google.respond({ method: "GET", pathIncludes: "/localPosts?" }, () => ({
      status: 503,
      json: {},
    }))
    const postId = await createDraft(owner.cookie, linked.locationId, "Clean")
    await admin`
      update gbp_local_post
      set status = 'published', google_post_name = ${name}
      where id = ${postId}
    `
    const removed = await fetch(
      `${server.baseUrl}/api/locations/${linked.locationId}/posts/${postId}`,
      { method: "DELETE", headers: { cookie: owner.cookie } }
    )
    expect(removed.status, await removed.clone().text()).toBe(200)
    expect(google.calls.some((call) => call.method === "GET")).toBe(false)
    const [attempt] = await admin<{ status: string }[]>`
      select status from gbp_local_post_attempt where post_id = ${postId}
    `
    expect(attempt.status).toBe("succeeded")
    const [row] = await storedPosts(linked.locationId)
    expect(row.status).toBe("deleted")
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
