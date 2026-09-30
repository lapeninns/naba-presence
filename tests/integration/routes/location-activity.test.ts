import { randomUUID } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { locationActivityResponseSchema } from "@/lib/contracts/location-activity"
import { startAppServer } from "../helpers/app-server"
import { createTestTenant, destroyTenants, seedGoogleConnection, seedLinkedReview, seedAwaitingApprovalPost, seedMemberUser, seedReview } from "../helpers/tenant"

const describeDatabase = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip

describeDatabase("unified location activity", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  beforeAll(async () => {
    if (!process.env.DIRECT_DATABASE_URL) throw new Error("Local database required")
    admin = postgres(process.env.DIRECT_DATABASE_URL, { max: 1 })
    server = await startAppServer()
  })
  afterAll(async () => {
    await server?.stop()
    await destroyTenants(admin, organisations)
    await admin?.end()
  })

  async function fixture() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName, replyState: "APPROVED" })
    return { ...owner, ...linked }
  }
  async function read(cookie: string, locationId: string, query = "") {
    const response = await fetch(`${server.baseUrl}/api/locations/${locationId}/activity${query}`, { headers: { cookie } })
    expect(response.status, await response.clone().text()).toBe(200)
    return locationActivityResponseSchema.parse(await response.json()).activity
  }

  it("projects every existing write family without inventing confirmation or review actors", async () => {
    const f = await fixture()
    const id = randomUUID()
    const at = "2026-09-29T10:00:00.123456Z"
    await admin`insert into gbp_management_mutation (id, organisation_id, location_id, actor_user_id, resource_type, operation, status, idempotency_key, created_at) values (${id}, ${f.organisationId}, ${f.locationId}, ${f.userId}, 'lodging', 'update', 'succeeded', ${id}, ${at})`
    await admin`insert into hours_sync_attempt (id, organisation_id, location_id, external_location_id, actor_user_id, status, idempotency_key, pinned_canonical_revision, pinned_canonical_hash, pinned_google_hash, intended_payload, created_at) values (${id}, ${f.organisationId}, ${f.locationId}, ${f.externalLocationId}, ${f.userId}, 'succeeded', ${id}, '1', 'canonical', 'google', '{}'::jsonb, ${at})`
    await admin`insert into profile_sync_attempt (id, organisation_id, location_id, external_location_id, actor_user_id, operation, direction, status, idempotency_key, pinned_canonical_revision, pinned_canonical_hash, pinned_google_hash, intended_payload, created_at) values (${id}, ${f.organisationId}, ${f.locationId}, ${f.externalLocationId}, ${f.userId}, 'publish_google', 'to_google', 'failed', ${id}, '1', 'canonical', 'google', '{}'::jsonb, ${at})`
    await admin`insert into food_menus_sync_attempt (id, organisation_id, location_id, external_location_id, actor_user_id, status, idempotency_key, expected_canonical_revision, expected_canonical_hash, expected_google_hash, intended_payload, created_at) values (${id}, ${f.organisationId}, ${f.locationId}, ${f.externalLocationId}, ${f.userId}, 'ambiguous', ${id}, '1', 'canonical', 'google', '{}'::jsonb, ${at})`
    await admin`insert into place_action_mutation (id, organisation_id, location_id, external_location_id, actor_user_id, operation, status, idempotency_key, created_at) values (${id}, ${f.organisationId}, ${f.locationId}, ${f.externalLocationId}, ${f.userId}, 'create', 'succeeded', ${id}, ${at})`
    await admin`insert into gbp_media_mutation (id, organisation_id, location_id, actor_user_id, operation, status, idempotency_key, created_at) values (${id}, ${f.organisationId}, ${f.locationId}, ${f.userId}, 'delete', 'failed', ${id}, ${at})`
    const post = await seedAwaitingApprovalPost(admin, { organisationId: f.organisationId, locationId: f.locationId, requestedBy: f.userId })
    await admin`insert into gbp_local_post_attempt (id, organisation_id, post_id, actor_user_id, operation, status, idempotency_key, intended_payload, created_at) values (${id}, ${f.organisationId}, ${post.id}, ${f.userId}, 'create', 'ambiguous', ${id}, '{}'::jsonb, ${at})`
    await admin`insert into publish_attempt (id, organisation_id, review_reply_id, idempotency_key, request_body_hash, status, attempt_no, started_at) select ${id}, ${f.organisationId}, id, ${id}, 'hash', 'accepted', 1, ${at} from review_reply where review_id = ${f.reviewId}`

    const first = await read(f.cookie, f.locationId, "?pageSize=3")
    expect(first.total).toBe(8)
    expect(first.items.map((item) => item.source)).toEqual(["reviews", "profile", "posts"])
    expect(first.items[0]).toMatchObject({ id: `reviews:${id}`, sourceId: id, actorUserId: null, confirmationState: "unrecorded" })
    expect(first.items.every((item) => item.confirmationState === "unrecorded")).toBe(true)
    expect(first.nextCursor).toBeTruthy()
    const second = await read(f.cookie, f.locationId, `?pageSize=3&cursor=${first.nextCursor}`)
    const third = await read(f.cookie, f.locationId, `?pageSize=3&cursor=${second.nextCursor}`)
    const items = [...first.items, ...second.items, ...third.items]
    expect(new Set(items.map((item) => item.id)).size).toBe(8)
    expect(items.map((item) => item.source).sort()).toEqual(["hours", "links", "management", "media", "menus", "posts", "profile", "reviews"])
    expect(third.nextCursor).toBeNull()
    const oldPage = await read(f.cookie, f.locationId, "?pageSize=3&page=2")
    expect(oldPage.items.map((item) => item.id)).toEqual(second.items.map((item) => item.id))
  })

  it("keeps cursor pages stable across inserts and rejects cross-location or malformed cursors", async () => {
    const f = await fixture()
    const expectedIds: string[] = []
    for (const at of ["2026-09-29T10:00:00.123457Z", "2026-09-29T10:00:00.123456Z", "2026-09-29T10:00:00.123455Z"]) {
      const id = randomUUID()
      expectedIds.push(`media:${id}`)
      await admin`insert into gbp_media_mutation (id, organisation_id, location_id, actor_user_id, operation, status, idempotency_key, created_at) values (${id}, ${f.organisationId}, ${f.locationId}, ${f.userId}, 'create', 'succeeded', ${id}, ${at}::text::timestamptz)`
    }
    const first = await read(f.cookie, f.locationId, "?pageSize=1")
    await admin`insert into gbp_media_mutation (organisation_id, location_id, actor_user_id, operation, status, idempotency_key) values (${f.organisationId}, ${f.locationId}, ${f.userId}, 'create', 'succeeded', ${randomUUID()})`
    const second = await read(f.cookie, f.locationId, `?pageSize=1&cursor=${first.nextCursor}`)
    const third = await read(f.cookie, f.locationId, `?pageSize=1&cursor=${second.nextCursor}`)
    expect([first.items[0]?.id, second.items[0]?.id, third.items[0]?.id]).toEqual(expectedIds)
    expect(third.nextCursor).toBeNull()
    const other = await fixture()
    const hidden = await fetch(`${server.baseUrl}/api/locations/${f.locationId}/activity`, { headers: { cookie: other.cookie } })
    expect(hidden.status).toBe(404)
    expect((await read(other.cookie, other.locationId)).total).toBe(0)
    const allowed = await seedReview(admin, { organisationId: f.organisationId })
    const member = await seedMemberUser(admin, { organisationId: f.organisationId, assignLocationId: allowed.locationId })
    const denied = await fetch(`${server.baseUrl}/api/locations/${f.locationId}/activity`, { headers: { cookie: member.cookie } })
    expect(denied.status).toBe(404)
    expect((await read(member.cookie, allowed.locationId)).total).toBe(0)
    for (const cursor of ["garbage", first.nextCursor]) {
      const invalid = await fetch(`${server.baseUrl}/api/locations/${other.locationId}/activity?cursor=${cursor}`, { headers: { cookie: other.cookie } })
      expect(invalid.status).toBe(400)
    }
  })
})
