import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  startGoogleStub,
  type GoogleStub,
  type GoogleStubCall,
} from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("provider-deleted review tombstones", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  let owner: Awaited<ReturnType<typeof createTestTenant>>
  let externalLocationId: string
  let locationId: string
  let googleAccountName: string
  let googleLocationName: string
  const present = new Set(Array.from({ length: 100 }, (_, index) => index))

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    owner = await createTestTenant(admin)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    googleAccountName = connection.googleAccountName
    const linked = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName,
    })
    externalLocationId = linked.externalLocationId
    locationId = linked.locationId
    await admin`
      delete from review
      where external_location_id = ${externalLocationId}
    `
    const [location] = await admin<{ google_location_name: string }[]>`
      select google_location_name
      from external_location
      where id = ${externalLocationId}
    `
    googleLocationName = location.google_location_name
    stub.respond(
      { method: "GET", pathIncludes: "/reviews" },
      (call) => page(call)
    )
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      GOOGLE_TIMEOUT_MS: "3000",
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, [owner.organisationId])
    await admin.end()
  })

  function review(index: number) {
    const id = `sweep-${String(index).padStart(3, "0")}`
    return {
      name: `${googleAccountName}/${googleLocationName}/reviews/${id}`,
      reviewId: id,
      reviewer: { displayName: "Sweep reviewer" },
      starRating: index % 2 === 0 ? "FIVE" : "FOUR",
      comment: `Sweep body ${id}`,
      createTime: "2026-06-01T10:00:00.000Z",
      updateTime: new Date(
        Date.parse("2026-07-01T12:00:00.000Z") - index * 60_000
      ).toISOString(),
    }
  }

  function page(call: GoogleStubCall) {
    const offset = Number(
      new URL(call.path, stub.baseUrl).searchParams.get("pageToken") ?? "0"
    )
    const reviews = [...present].sort((a, b) => a - b)
    const slice = reviews.slice(offset, offset + 50)
    return {
      status: 200,
      json: {
        reviews: slice.map(review),
        ...(offset + 50 < reviews.length
          ? { nextPageToken: String(offset + 50) }
          : {}),
      },
    }
  }

  function postSync(
    path: "backfill" | "reconcile" | "sweep",
    body: Record<string, unknown>
  ) {
    return fetch(`${server.baseUrl}/api/sync/${path}`, {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    })
  }

  function appGet(path: string) {
    return fetch(`${server.baseUrl}${path}`, {
      headers: { cookie: owner.cookie },
    })
  }

  it("tombstones only after a complete sweep and restores reappearing reviews", async () => {
    const backfill = await postSync("backfill", {
      externalLocationIds: [externalLocationId],
      maxPagesPerLocation: 20,
    })
    expect(backfill.status, await backfill.clone().text()).toBe(200)
    const [removedReview] = await admin<{ id: string }[]>`
      select id::text as id
      from review
      where organisation_id = ${owner.organisationId}
        and google_review_id_hash =
          encode(digest('sweep-095', 'sha256'), 'hex')
    `
    expect(removedReview).toBeDefined()

    for (let index = 90; index < 100; index += 1) present.delete(index)
    const sweep = await postSync("sweep", {
      externalLocationIds: [externalLocationId],
      maxPagesPerLocation: 50,
    })
    expect(sweep.status, await sweep.clone().text()).toBe(200)

    const [tombstones] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from review
      where organisation_id = ${owner.organisationId}
        and provider_deleted_at is not null
    `
    expect(tombstones.count).toBe(10)

    const list = await appGet("/api/reviews?search=sweep-095")
    expect(list.status, await list.clone().text()).toBe(200)
    expect((await list.json()) as { items: unknown[] }).toMatchObject({
      items: [],
    })
    const detail = await appGet(`/api/reviews/${removedReview.id}`)
    expect(detail.status).toBe(404)

    const analytics = await appGet(
      "/api/analytics/overview?from=2026-05-01T00:00:00.000Z&to=2026-08-01T00:00:00.000Z"
    )
    expect(analytics.status, await analytics.clone().text()).toBe(200)
    const analyticsBody = (await analytics.json()) as {
      summary: { reviewVolume: number }
      locations: Array<{ id: string; reviews: number }>
    }
    expect(analyticsBody.summary.reviewVolume).toBe(90)
    expect(analyticsBody.locations).toContainEqual(
      expect.objectContaining({ id: locationId, reviews: 90 })
    )
    const [audit] = await admin<
      { metadata: { tombstoned: number; locationId: string } }[]
    >`
      select metadata
      from audit_log
      where organisation_id = ${owner.organisationId}
        and action = 'review.provider_deleted'
      order by created_at desc
      limit 1
    `
    expect(audit.metadata).toMatchObject({
      tombstoned: 10,
      locationId,
    })

    present.add(95)
    const reconcile = await postSync("reconcile", {
      externalLocationIds: [externalLocationId],
    })
    expect(reconcile.status, await reconcile.clone().text()).toBe(200)
    const [restored] = await admin<{ provider_deleted_at: Date | null }[]>`
      select provider_deleted_at
      from review
      where id = ${removedReview.id}
    `
    expect(restored.provider_deleted_at).toBeNull()
    const restoredDetail = await appGet(
      `/api/reviews/${removedReview.id}`
    )
    expect(restoredDetail.status).toBe(200)

    for (let index = 80; index < 90; index += 1) present.delete(index)
    const [beforeIncomplete] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from review
      where organisation_id = ${owner.organisationId}
        and provider_deleted_at is not null
    `
    const incomplete = await postSync("sweep", {
      externalLocationIds: [externalLocationId],
      maxPagesPerLocation: 1,
    })
    expect(incomplete.status, await incomplete.clone().text()).toBe(200)
    const [afterIncomplete] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from review
      where organisation_id = ${owner.organisationId}
        and provider_deleted_at is not null
    `
    expect(afterIncomplete.count).toBe(beforeIncomplete.count)
    const [checkpoint] = await admin<
      { status: string; last_error_code: string | null }[]
    >`
      select status, last_error_code
      from sync_checkpoint
      where organisation_id = ${owner.organisationId}
        and external_location_id = ${externalLocationId}
        and sync_type = 'sweep'
    `
    expect(checkpoint).toMatchObject({
      status: "failed",
      last_error_code: "sweep_incomplete",
    })
  })
})
