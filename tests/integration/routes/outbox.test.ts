import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedMemberUser,
  seedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

type Item = {
  id: string
  kind: string
  state: string
  title: string
  detail: string | null
  locationId: string | null
  clientId: string | null
  clientName: string | null
  href: string
}
type Page = {
  items: Item[]
  nextCursor: string | null
  truncated: boolean
  unavailable: string[]
  paused: string[]
}

const GROUPS: Record<string, string[]> = {
  person: ["approval", "changes", "approved"],
  google: ["sending", "retrying", "waiting", "uncertain"],
  failed: ["rejected", "failed"],
  live: ["live"],
}

/**
 * GET /api/outbox and /api/outbox/counts (lib/server/outbox.ts): a
 * read-only union of replies, listing change receipts, posts and bulk
 * listing changes, narrowed to the listings the session can see and then
 * to the client or listing asked for. Each tenant here is its own, so the
 * isolation cases prove absence rather than filter a shared fixture.
 */
describeDatabase("GET /api/outbox", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  let owner: Awaited<ReturnType<typeof createTestTenant>>
  let other: Awaited<ReturnType<typeof createTestTenant>>
  // `first` is filed under the client; `second` is unfiled.
  let first: { reviewId: string; locationId: string }
  let second: { reviewId: string; locationId: string }
  let clientId: string
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    server = await startAppServer()

    owner = await createTestTenant(admin)
    other = await createTestTenant(admin)
    organisations.push(owner.organisationId, other.organisationId)
    const org = owner.organisationId

    first = await seedReview(admin, { organisationId: org })
    second = await seedReview(admin, { organisationId: org })
    // The other tenant has work of its own that must never leak.
    const foreign = await seedReview(admin, {
      organisationId: other.organisationId,
    })

    const [client] = await admin<{ id: string }[]>`
      insert into client (organisation_id, name, slug)
      values (${org}, 'Journey Hospitality', ${`journey-${randomUUID().slice(0, 8)}`})
      returning id::text as id
    `
    clientId = client.id
    await admin`update location set client_id = ${clientId} where id = ${first.locationId}`

    // Replies: one waiting for approval (first), one failed (second), each
    // walked through the workflow trigger's allowed transitions.
    const walk = async (reviewId: string, steps: string[]) => {
      for (const step of steps)
        await admin`update review set workflow_status = ${step} where id = ${reviewId}`
    }
    await walk(first.reviewId, ["drafted", "verified", "awaiting_approval"])
    await walk(second.reviewId, [
      "drafted",
      "verified",
      "publish_requested",
      "failed",
    ])
    await walk(foreign.reviewId, [
      "drafted",
      "verified",
      "publish_requested",
      "failed",
    ])

    const receipt = async (input: {
      organisationId?: string
      locationId: string
      surface: string
      state: string
      errorCode?: string | null
      updatedAt?: string
      intentId?: string
      approvalRef?: string | null
      changeRequest?: Record<string, unknown> | null
      receipt?: Record<string, string> | null
    }) => {
      const [row] = await admin<{ id: string }[]>`
        insert into mutation_operation (
          organisation_id, intent_id, surface, action, location_id,
          payload_hash, state, error_code, approval_ref, change_request,
          receipt, created_at, updated_at
        ) values (
          ${input.organisationId ?? org}, ${input.intentId ?? randomUUID()},
          ${input.surface}, 'publish', ${input.locationId},
          ${"h".repeat(32)}, ${input.state}, ${input.errorCode ?? null},
          ${input.approvalRef ?? null},
          ${input.changeRequest ? admin.json(input.changeRequest as never) : null},
          ${input.receipt ? admin.json(input.receipt) : null},
          now() - interval '1 hour',
          coalesce(${input.updatedAt ?? null}::timestamptz, now())
        )
        returning id::text as id
      `
      return row.id
    }

    ids.hoursFailed = await receipt({
      locationId: first.locationId,
      surface: "hours",
      state: "failed",
      errorCode: "google_api_error",
    })
    ids.profileWaiting = await receipt({
      locationId: second.locationId,
      surface: "profile",
      state: "awaiting_confirmation",
    })
    ids.mediaUncertain = await receipt({
      locationId: second.locationId,
      surface: "media",
      state: "uncertain",
    })
    ids.menuLive = await receipt({
      locationId: first.locationId,
      surface: "food_menus",
      state: "confirmed_applied",
    })
    ids.oldLive = await receipt({
      locationId: second.locationId,
      surface: "media",
      state: "confirmed_applied",
      updatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    })
    ids.withdrawn = await receipt({
      locationId: second.locationId,
      surface: "hours",
      state: "failed",
      errorCode: "approval_withdrawn",
      changeRequest: { kind: "hours_publish", target: null, body: {} },
    })
    ids.sentBack = await receipt({
      locationId: second.locationId,
      surface: "food_menus",
      state: "failed",
      errorCode: "approval_rejected",
      changeRequest: { kind: "food_menus_publish", target: null, body: {} },
    })
    // An approved change request and the dispatch it ran: one change.
    const dispatchIntentId = randomUUID()
    ids.request = await receipt({
      locationId: first.locationId,
      surface: "profile",
      state: "sent",
      changeRequest: { kind: "profile_publish", target: null, body: {} },
      receipt: { dispatchIntentId },
    })
    ids.dispatch = await receipt({
      locationId: first.locationId,
      surface: "profile",
      state: "sent",
      intentId: dispatchIntentId,
    })
    // Not a listing editor's surface.
    ids.reviewBulk = await receipt({
      locationId: first.locationId,
      surface: "review_bulk",
      state: "failed",
    })
    ids.foreign = await receipt({
      organisationId: other.organisationId,
      locationId: foreign.locationId,
      surface: "hours",
      state: "failed",
    })

    // Posts: one sent from here that Google has not shown yet (sent, never
    // "On Google"), and one synced in from Google (no attempt: not ours).
    const [{ externalLocationId }] = await admin<
      { externalLocationId: string }[]
    >`
      select external_location_id::text as "externalLocationId"
      from review where id = ${second.reviewId}
    `
    const post = async (status: string, googleState: string | null) => {
      const [row] = await admin<{ id: string }[]>`
        insert into gbp_local_post (
          organisation_id, location_id, external_location_id, topic_type,
          summary, status, google_state
        ) values (
          ${org}, ${second.locationId}, ${externalLocationId}, 'STANDARD',
          'Autumn menu launches on Friday', ${status}, ${googleState}
        )
        returning id::text as id
      `
      return row.id
    }
    ids.post = await post("published", "PROCESSING")
    // Sent from here before Google has answered at all: still waiting.
    ids.postUnanswered = await post("published", null)
    ids.importedPost = await post("published", "LIVE")
    for (const postId of [ids.post, ids.postUnanswered])
      await admin`
        insert into gbp_local_post_attempt (
          organisation_id, post_id, actor_user_id, operation, status,
          idempotency_key, intended_payload
        ) values (
          ${org}, ${postId}, ${owner.userId}, 'create', 'succeeded',
          ${randomUUID()}, '{}'::jsonb
        )
      `

    // A running bulk hours change over both listings: one listing failed,
    // the other still queued. Its own hours receipt is the bulk row's.
    await admin`
      insert into organisation_feature (organisation_id, feature, enabled, changed_by)
      values (${org}, 'bulk_actions', true, 'test')
      on conflict (organisation_id, feature) do update set enabled = true
    `
    const [bulk] = await admin<{ id: string }[]>`
      insert into bulk_listing_operation (
        organisation_id, operation, input, items, target_location_ids,
        preview_hash, requested_by, require_two_person_approval,
        status, approved_by, approved_at, dispatch_expires_at,
        execute_requested_at
      ) values (
        ${org}, 'regular_hours', ${admin.json({})}, ${admin.json([{}])},
        ${[first.locationId, second.locationId]}::uuid[], ${"b".repeat(64)},
        ${owner.userId}, false, 'running', ${owner.userId}, now(),
        now() + interval '1 day', now()
      )
      returning id::text as id
    `
    ids.bulk = bulk.id
    const child = (locationId: string, status: string) => admin`
      insert into bulk_listing_child (
        organisation_id, operation_id, location_id, eligibility, status,
        resource_key, seq, item_key, input, started_at, finished_at
      ) values (
        ${org}, ${bulk.id}, ${locationId}, 'eligible', ${status}, 'hours', 0,
        '0:regular_hours', ${admin.json({})}, now(),
        ${status === "failed" ? new Date() : null}
      )
    `
    await child(first.locationId, "failed")
    await child(second.locationId, "queued")
    // On the other listing, so it is not also a later write that settles
    // `hoursFailed`.
    ids.bulkReceipt = await receipt({
      locationId: second.locationId,
      surface: "hours",
      state: "sent",
      approvalRef: `bulk_listing_operation:${bulk.id}`,
    })
  })

  afterAll(async () => {
    await server?.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function read<T = Page>(cookie: string, path = "/api/outbox") {
    const response = await fetch(`${server.baseUrl}${path}`, {
      headers: { cookie },
    })
    return { status: response.status, body: (await response.json()) as T }
  }

  /** Every row, following the cursor to the end. */
  async function readAll(cookie: string, query = "") {
    const items: Item[] = []
    let cursor: string | null = null
    for (let guard = 0; guard < 20; guard += 1) {
      const params = new URLSearchParams(query)
      if (cursor) params.set("cursor", cursor)
      const { status, body } = await read(cookie, `/api/outbox?${params}`)
      expect(status).toBe(200)
      items.push(...body.items)
      cursor = body.nextCursor
      if (!cursor) break
    }
    return items
  }

  const byId = (items: Item[]) => new Map(items.map((item) => [item.id, item]))

  it("lists each write once, in its Outbox state, for an owner", async () => {
    const { status, body } = await read(owner.cookie)
    expect(status).toBe(200)
    expect(body.unavailable).toEqual([])
    const items = byId(body.items)

    // Waiting for a person
    expect(items.get(`reply:${first.reviewId}`)).toMatchObject({
      kind: "reply",
      state: "approval",
      clientId,
      clientName: "Journey Hospitality",
      href: `/inbox?queue=approval&selected=${first.reviewId}`,
    })
    expect(items.get(`listing_change:${ids.sentBack}`)?.state).toBe("changes")
    // With Google
    expect(items.get(`listing_change:${ids.request}`)?.state).toBe("sending")
    expect(items.get(`listing_change:${ids.profileWaiting}`)?.state).toBe(
      "waiting"
    )
    expect(items.get(`listing_change:${ids.mediaUncertain}`)?.state).toBe(
      "uncertain"
    )
    expect(items.get(`post:${ids.post}`)).toMatchObject({
      state: "waiting",
      title: "Post",
      href: `/listings/${second.locationId}/posts`,
    })
    expect(items.get(`post:${ids.postUnanswered}`)?.state).toBe("waiting")
    expect(items.get(`bulk:${ids.bulk}:sending`)).toMatchObject({
      kind: "bulk",
      locationId: second.locationId,
      detail: "1 of 2 listings",
      href: `/listings/bulk/${ids.bulk}`,
    })
    // Failed
    expect(items.get(`reply:${second.reviewId}`)).toMatchObject({
      state: "failed",
      clientId: null,
      href: `/inbox?queue=failed&selected=${second.reviewId}`,
    })
    expect(items.get(`listing_change:${ids.hoursFailed}`)).toMatchObject({
      state: "failed",
      title: "Opening hours",
      href: `/listings/${first.locationId}/hours`,
    })
    expect(items.get(`bulk:${ids.bulk}:failed`)).toMatchObject({
      state: "failed",
      locationId: first.locationId,
      clientId,
    })
    // Confirmed today
    expect(items.get(`listing_change:${ids.menuLive}`)?.state).toBe("live")

    // Left out: confirmed more than a day ago, a withdrawn request, the
    // dispatch twin of an approved request, a non-listing surface, a bulk
    // child's own receipt, a post synced in from Google, and another
    // tenant's rows.
    for (const id of [
      `listing_change:${ids.oldLive}`,
      `listing_change:${ids.withdrawn}`,
      `listing_change:${ids.dispatch}`,
      `listing_change:${ids.reviewBulk}`,
      `listing_change:${ids.bulkReceipt}`,
      `listing_change:${ids.foreign}`,
      `post:${ids.importedPost}`,
    ])
      expect(items.has(id)).toBe(false)
    // Only confirmed rows may be On Google.
    expect(
      body.items.filter((item) => item.state === "live").map((i) => i.id)
    ).toEqual([`listing_change:${ids.menuLive}`])
    // Groups in reading order: person, google, failed, live.
    const ranks = body.items.map((item) =>
      Object.keys(GROUPS).findIndex((g) => GROUPS[g].includes(item.state))
    )
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })

  it("counts the same rows by group", async () => {
    const list = await read(owner.cookie)
    const { status, body } = await read<Record<string, number | boolean>>(
      owner.cookie,
      "/api/outbox/counts"
    )
    expect(status).toBe(200)
    const states = list.body.items.map((item) => item.state)
    const inGroup = (group: string[]) =>
      states.filter((state) => group.includes(state)).length
    expect(body).toEqual({
      person: inGroup(GROUPS.person),
      google: inGroup(GROUPS.google),
      failed: inGroup(GROUPS.failed),
      live: inGroup(GROUPS.live),
      partial: false,
    })
    expect(body.failed).toBe(3)
  })

  it("filters to one group", async () => {
    const { body } = await read(owner.cookie, "/api/outbox?group=failed")
    expect(body.items.length).toBe(3)
    expect(body.items.every((item) => GROUPS.failed.includes(item.state))).toBe(
      true
    )
  })

  it("pages through every row exactly once", async () => {
    const whole = (await read(owner.cookie, "/api/outbox?limit=100")).body
    expect(whole.nextCursor).toBeNull()
    const first = await read(owner.cookie, "/api/outbox?limit=3")
    expect(first.body.items).toHaveLength(3)
    expect(first.body.nextCursor).toBeTruthy()
    const paged = await readAll(owner.cookie, "limit=3")
    expect(paged.map((item) => item.id)).toEqual(
      whole.items.map((item) => item.id)
    )
  })

  it("refuses a malformed cursor, id or page size", async () => {
    for (const query of [
      "cursor=not-a-cursor",
      "client_id=nope",
      "group=everything",
      "limit=1000",
    ])
      expect((await read(owner.cookie, `/api/outbox?${query}`)).status).toBe(
        400
      )
  })

  it("narrows to a client or a listing", async () => {
    const forClient = await readAll(owner.cookie, `client_id=${clientId}`)
    expect(forClient.length).toBeGreaterThan(0)
    expect(new Set(forClient.map((item) => item.locationId))).toEqual(
      new Set([first.locationId])
    )
    expect(forClient.every((item) => item.clientId === clientId)).toBe(true)

    const forListing = await readAll(
      owner.cookie,
      `location_id=${second.locationId}`
    )
    expect(new Set(forListing.map((item) => item.locationId))).toEqual(
      new Set([second.locationId])
    )

    const counts = await read<Record<string, number>>(
      owner.cookie,
      `/api/outbox/counts?client_id=${clientId}`
    )
    expect(counts.body.failed).toBe(2)

    // Another tenant's client reads as empty, never as its rows.
    const [foreignClient] = await admin<{ id: string }[]>`
      insert into client (organisation_id, name, slug)
      values (${other.organisationId}, 'Elsewhere', ${`elsewhere-${randomUUID().slice(0, 8)}`})
      returning id::text as id
    `
    const foreignRead = await read(
      owner.cookie,
      `/api/outbox?client_id=${foreignClient.id}`
    )
    expect(foreignRead.status).toBe(200)
    expect(foreignRead.body.items).toEqual([])
  })

  it("shows a member only the listings they are granted", async () => {
    const member = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      role: "member",
      canPublish: true,
      assignLocationId: first.locationId,
    })
    const items = await readAll(member.cookie)
    expect(items.length).toBeGreaterThan(0)
    expect(new Set(items.map((item) => item.locationId))).toEqual(
      new Set([first.locationId])
    )
    const seen = byId(items)
    expect(seen.has(`reply:${second.reviewId}`)).toBe(false)
    expect(seen.has(`post:${ids.post}`)).toBe(false)
    // A bulk batch is the requester's and the managers': not this member's.
    expect(items.some((item) => item.kind === "bulk")).toBe(false)

    // Narrowing to a hidden listing reads as empty.
    const hidden = await read(
      member.cookie,
      `/api/outbox?location_id=${second.locationId}`
    )
    expect(hidden.status).toBe(200)
    expect(hidden.body.items).toEqual([])

    const counts = await read<Record<string, number>>(
      member.cookie,
      "/api/outbox/counts"
    )
    expect(counts.body.failed).toBe(1)
  })

  it("shows another tenant none of this tenant's work", async () => {
    const items = await readAll(other.cookie)
    const ownIds = new Set([first.locationId, second.locationId])
    expect(items.some((item) => ownIds.has(item.locationId ?? ""))).toBe(false)
    expect(items.some((item) => item.id.includes(ids.bulk))).toBe(false)
    expect(items.map((item) => item.id)).toContain(
      `listing_change:${ids.foreign}`
    )
  })

  it("has no Outbox for a viewer", async () => {
    const viewer = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      role: "viewer",
    })
    expect((await read(viewer.cookie)).status).toBe(403)
    expect((await read(viewer.cookie, "/api/outbox/counts")).status).toBe(403)
  })

  it("is never kept by a shared cache", async () => {
    for (const path of ["/api/outbox", "/api/outbox/counts"]) {
      const response = await fetch(`${server.baseUrl}${path}`, {
        headers: { cookie: owner.cookie },
      })
      expect(response.status).toBe(200)
      const cacheControl = response.headers.get("cache-control") ?? ""
      expect(cacheControl, path).toMatch(/\b(no-store|private)\b/)
      expect(cacheControl, path).not.toMatch(/\b(public|s-maxage)\b/)
    }
  })

  it("shows an ambiguous deletion even when the previous confirmation is too old for the Outbox", async () => {
    const tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    const review = await seedReview(admin, {
      organisationId: tenant.organisationId,
    })
    for (const step of [
      "drafted",
      "verified",
      "publish_requested",
      "published",
    ])
      await admin`update review set workflow_status = ${step} where id = ${review.reviewId}`
    const [reply] = await admin`
      insert into review_reply (
        organisation_id, review_id, current_body, publish_status,
        google_reply_state, google_reply_updated_at, published_by
      )
      values (${tenant.organisationId}, ${review.reviewId}, 'Previous reply',
        'published', 'APPROVED', now() - interval '2 days', ${tenant.userId})
      returning id
    `
    expect(
      byId(await readAll(tenant.cookie)).has(`reply:${review.reviewId}`)
    ).toBe(false)
    await admin`
      insert into publish_attempt (
        organisation_id, review_reply_id, idempotency_key, request_body_hash,
        operation, status, attempt_no
      )
      values (${tenant.organisationId}, ${reply.id}, ${randomUUID()}, 'delete',
        'delete', 'ambiguous', 1)
    `
    expect(
      byId(await readAll(tenant.cookie)).get(`reply:${review.reviewId}`)
    ).toMatchObject({
      state: "uncertain",
      title: expect.stringMatching(/^Delete reply to /),
    })
  })

  it("keeps an unresolved post deletion out of the confirmed group", async () => {
    const tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    const { reviewId, locationId } = await seedReview(admin, {
      organisationId: tenant.organisationId,
    })
    const [{ externalLocationId }] = await admin<
      { externalLocationId: string }[]
    >`
      select external_location_id::text as "externalLocationId"
      from review where id = ${reviewId}
    `
    const [post] = await admin`
      insert into gbp_local_post (
        organisation_id, location_id, external_location_id, topic_type,
        summary, status, google_state
      ) values (
        ${tenant.organisationId}, ${locationId}, ${externalLocationId}, 'STANDARD',
        'Previously confirmed post', 'published', 'LIVE'
      ) returning id
    `
    await admin`
      insert into gbp_local_post_attempt (
        organisation_id, post_id, actor_user_id, operation, status,
        idempotency_key, intended_payload, started_at
      ) values
      (${tenant.organisationId}, ${post.id}, ${tenant.userId}, 'create', 'succeeded',
        ${randomUUID()}, '{}'::jsonb, now() - interval '3 days'),
      (${tenant.organisationId}, ${post.id}, ${tenant.userId}, 'delete', 'ambiguous',
        ${randomUUID()}, '{}'::jsonb, now() - interval '2 days')
    `
    expect(
      byId(await readAll(tenant.cookie)).get(`post:${post.id}`)
    ).toMatchObject({
      state: "uncertain",
      title: "Delete post",
    })
  })

  it("needs a session", async () => {
    expect((await fetch(`${server.baseUrl}/api/outbox`)).status).toBe(401)
    expect((await fetch(`${server.baseUrl}/api/outbox/counts`)).status).toBe(
      401
    )
  })
})
