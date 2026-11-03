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
  locationId: string
  clientId: string | null
  clientName: string | null
  href: string
}

/**
 * GET /api/outbox and /api/outbox/counts (lib/server/outbox.ts): a
 * read-only union of replies, listing change receipts and posts, narrowed to
 * the listings the session can see. Each tenant here is its own, so the
 * isolation cases prove absence rather than filter a shared fixture.
 */
describeDatabase("GET /api/outbox", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  let owner: Awaited<ReturnType<typeof createTestTenant>>
  let other: Awaited<ReturnType<typeof createTestTenant>>
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
      changeRequest?: object | null
      receipt?: object | null
    }) => {
      const [row] = await admin<{ id: string }[]>`
        insert into mutation_operation (
          organisation_id, intent_id, surface, action, location_id,
          payload_hash, state, error_code, change_request, receipt,
          created_at, updated_at
        ) values (
          ${input.organisationId ?? org}, ${input.intentId ?? randomUUID()},
          ${input.surface}, 'publish', ${input.locationId},
          ${"h".repeat(32)}, ${input.state}, ${input.errorCode ?? null},
          ${input.changeRequest ? admin.json(input.changeRequest) : null},
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
    ids.bulk = await receipt({
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

    // A post Google has not shown yet: sent, never "On Google".
    const [{ externalLocationId }] = await admin<
      { externalLocationId: string }[]
    >`
      select external_location_id::text as "externalLocationId"
      from review where id = ${second.reviewId}
    `
    const [post] = await admin<{ id: string }[]>`
      insert into gbp_local_post (
        organisation_id, location_id, external_location_id, topic_type,
        summary, status, google_state
      ) values (
        ${org}, ${second.locationId}, ${externalLocationId}, 'STANDARD',
        'Autumn menu launches on Friday', 'published', 'PROCESSING'
      )
      returning id::text as id
    `
    ids.post = post.id
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function read(cookie: string, path = "/api/outbox") {
    const response = await fetch(`${server.baseUrl}${path}`, {
      headers: { cookie },
    })
    return { status: response.status, body: await response.json() }
  }

  const byId = (items: Item[]) => new Map(items.map((item) => [item.id, item]))

  it("lists each write once, in its Outbox state, for an owner", async () => {
    const { status, body } = await read(owner.cookie)
    expect(status).toBe(200)
    const items = byId(body.items as Item[])

    expect(items.get(`reply:${first.reviewId}`)).toMatchObject({
      kind: "reply",
      state: "approval",
      clientId,
      clientName: "Journey Hospitality",
      href: `/inbox?queue=approval&selected=${first.reviewId}`,
    })
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
    expect(items.get(`listing_change:${ids.profileWaiting}`)?.state).toBe(
      "waiting"
    )
    expect(items.get(`listing_change:${ids.menuLive}`)?.state).toBe("live")
    expect(items.get(`listing_change:${ids.sentBack}`)?.state).toBe("changes")
    expect(items.get(`listing_change:${ids.request}`)?.state).toBe("sending")
    expect(items.get(`post:${ids.post}`)).toMatchObject({
      state: "waiting",
      title: "Post",
      href: `/listings/${second.locationId}/posts`,
    })

    // Left out: confirmed more than a day ago, a withdrawn request, the
    // dispatch twin of an approved request, a non-listing surface, and
    // another tenant's rows.
    for (const id of [
      `listing_change:${ids.oldLive}`,
      `listing_change:${ids.withdrawn}`,
      `listing_change:${ids.dispatch}`,
      `listing_change:${ids.bulk}`,
      `listing_change:${ids.foreign}`,
    ])
      expect(items.has(id)).toBe(false)
    // Only confirmed rows may be On Google.
    expect(
      [...items.values()].filter((item) => item.state === "live").map((i) => i.id)
    ).toEqual([`listing_change:${ids.menuLive}`])
  })

  it("counts the same rows by group", async () => {
    const list = await read(owner.cookie)
    const { status, body } = await read(owner.cookie, "/api/outbox/counts")
    expect(status).toBe(200)
    const states = (list.body.items as Item[]).map((item) => item.state)
    const inGroup = (group: string[]) =>
      states.filter((state) => group.includes(state)).length
    expect(body).toEqual({
      person: inGroup(["approval", "changes", "approved"]),
      google: inGroup(["sending", "retrying", "waiting", "uncertain"]),
      failed: inGroup(["rejected", "failed"]),
      live: inGroup(["live"]),
    })
    expect(body.failed).toBe(2)
  })

  it("shows a member only the listings they are granted", async () => {
    const member = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      role: "member",
      canPublish: true,
      assignLocationId: first.locationId,
    })
    const { status, body } = await read(member.cookie)
    expect(status).toBe(200)
    const items = body.items as Item[]
    expect(items.length).toBeGreaterThan(0)
    expect(new Set(items.map((item) => item.locationId))).toEqual(
      new Set([first.locationId])
    )
    expect(byId(items).has(`reply:${second.reviewId}`)).toBe(false)
    expect(byId(items).has(`post:${ids.post}`)).toBe(false)
    const counts = await read(member.cookie, "/api/outbox/counts")
    expect(counts.body.failed).toBe(1)
  })

  it("shows another tenant none of this tenant's work", async () => {
    const { status, body } = await read(other.cookie)
    expect(status).toBe(200)
    const items = body.items as Item[]
    const ownIds = new Set([first.locationId, second.locationId])
    expect(items.some((item) => ownIds.has(item.locationId))).toBe(false)
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

  it("needs a session", async () => {
    const response = await fetch(`${server.baseUrl}/api/outbox`)
    expect(response.status).toBe(401)
  })
})
