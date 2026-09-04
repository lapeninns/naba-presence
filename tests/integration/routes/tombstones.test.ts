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
  let omitProviderTotals = false
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
    stub.respond({ method: "GET", pathIncludes: "/reviews" }, (call) =>
      page(call)
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
        ...(!omitProviderTotals ? { totalReviewCount: reviews.length } : {}),
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
    const restoredDetail = await appGet(`/api/reviews/${removedReview.id}`)
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

  it("preserves stored history when Google returns an unexplained empty page", async () => {
    omitProviderTotals = true
    present.clear()
    await admin`
      update review
      set provider_deleted_at = null, last_seen_at = null
      where external_location_id = ${externalLocationId}
    `
    await admin`
      update sync_checkpoint
      set page_token = null, sweep_started_at = null
      where organisation_id = ${owner.organisationId}
        and external_location_id = ${externalLocationId}
        and sync_type = 'sweep'
    `

    const response = await postSync("sweep", {
      externalLocationIds: [externalLocationId],
      maxPagesPerLocation: 50,
    })
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({
      locations: [
        {
          status: "failed",
          errorCode: "sweep_provider_count_mismatch",
        },
      ],
    })

    const [reviews] = await admin<{ stored: number; visible: number }[]>`
      select
        count(*)::integer as stored,
        count(*) filter (
          where provider_deleted_at is null
        )::integer as visible
      from review
      where external_location_id = ${externalLocationId}
    `
    expect(reviews.visible).toBe(reviews.stored)
    expect(reviews.visible).toBeGreaterThan(0)

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
      last_error_code: "sweep_provider_count_mismatch",
    })
  })
})

describeDatabase("sweeps larger than one page budget", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  let owner: Awaited<ReturnType<typeof createTestTenant>>
  let externalLocationId: string
  let googleAccountName: string
  let googleLocationName: string
  // Six pages at the provider's pageSize of 50 - more than the five the job
  // runner allows a single claim.
  const present = new Set(Array.from({ length: 300 }, (_, index) => index))

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
    stub.respond({ method: "GET", pathIncludes: "/reviews" }, (call) => {
      const offset = Number(
        new URL(call.path, stub.baseUrl).searchParams.get("pageToken") ?? "0"
      )
      const reviews = [...present].sort((a, b) => a - b)
      const slice = reviews.slice(offset, offset + 50)
      const id = (index: number) => `big-${String(index).padStart(3, "0")}`
      return {
        status: 200,
        json: {
          reviews: slice.map((index) => ({
            name: `${googleAccountName}/${googleLocationName}/reviews/${id(index)}`,
            reviewId: id(index),
            reviewer: { displayName: "Sweep reviewer" },
            starRating: "FIVE",
            comment: `Sweep body ${id(index)}`,
            createTime: "2026-06-01T10:00:00.000Z",
            updateTime: new Date(
              Date.parse("2026-07-01T12:00:00.000Z") - index * 60_000
            ).toISOString(),
          })),
          totalReviewCount: reviews.length,
          ...(offset + 50 < reviews.length
            ? { nextPageToken: String(offset + 50) }
            : {}),
        },
      }
    })
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

  function sweep(maxPagesPerLocation: number) {
    return fetch(`${server.baseUrl}/api/sync/sweep`, {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        externalLocationIds: [externalLocationId],
        maxPagesPerLocation,
      }),
    })
  }

  function checkpoint() {
    return admin<
      {
        status: string
        last_error_code: string | null
        page_token: string | null
        next_attempt_at: Date | null
      }[]
    >`
      select status, last_error_code, page_token, next_attempt_at
      from sync_checkpoint
      where organisation_id = ${owner.organisationId}
        and external_location_id = ${externalLocationId}
        and sync_type = 'sweep'
    `
  }

  it("parks out of the claim window and resumes from its page token", async () => {
    const first = await sweep(1)
    expect(first.status, await first.clone().text()).toBe(200)
    const [parked] = await checkpoint()
    // Terminal for the job runner: 'failed' with a due next_attempt_at is a
    // claim state, so re-driving a page budget the location cannot fit under
    // would loop for ever. The cursor survives so the next sweep resumes.
    expect(parked).toMatchObject({
      status: "failed",
      last_error_code: "sweep_incomplete",
      page_token: "50",
    })
    expect(parked.next_attempt_at).toBeNull()

    stub.calls.length = 0
    const resumed = await sweep(1)
    expect(resumed.status, await resumed.clone().text()).toBe(200)
    expect(stub.calls[0]?.path).toContain("pageToken=50")
    const [advanced] = await checkpoint()
    expect(advanced.page_token).toBe("100")

    // Four more single-page sweeps finish the enumeration. Against a sweep
    // that restarts at page one this never terminates, however many run.
    let completed = false
    for (let attempt = 0; attempt < 6 && !completed; attempt += 1) {
      const next = await sweep(1)
      expect(next.status, await next.clone().text()).toBe(200)
      const [state] = await checkpoint()
      completed = state.status === "succeeded"
    }
    expect(completed).toBe(true)
    const [finished] = await checkpoint()
    expect(finished.page_token).toBeNull()

    // Every review was seen across the resumed run, so nothing is tombstoned.
    const [tombstones] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from review
      where organisation_id = ${owner.organisationId}
        and provider_deleted_at is not null
    `
    expect(tombstones.count).toBe(0)
    const [ingested] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from review
      where organisation_id = ${owner.organisationId}
    `
    expect(ingested.count).toBe(300)
  }, 60_000)

  it("tombstones what a resumed sweep never saw", async () => {
    for (let index = 290; index < 300; index += 1) present.delete(index)
    const first = await sweep(3)
    expect(first.status, await first.clone().text()).toBe(200)
    const [parked] = await checkpoint()
    expect(parked.status).toBe("failed")
    const [midway] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from review
      where organisation_id = ${owner.organisationId}
        and provider_deleted_at is not null
    `
    // A partial enumeration must never delete: the missing reviews are only
    // known to be missing once the last page lands.
    expect(midway.count).toBe(0)

    const rest = await sweep(3)
    expect(rest.status, await rest.clone().text()).toBe(200)
    const [done] = await checkpoint()
    expect(done.status).toBe("succeeded")
    const [tombstones] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from review
      where organisation_id = ${owner.organisationId}
        and provider_deleted_at is not null
    `
    expect(tombstones.count).toBe(10)
  }, 60_000)
})
