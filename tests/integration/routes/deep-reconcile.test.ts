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

describeDatabase("deep review reconciliation", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  let owner: Awaited<ReturnType<typeof createTestTenant>>
  let externalLocationId: string
  let googleAccountName: string
  let googleLocationName: string
  let changed = false

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
    const id = `deep-${String(index).padStart(3, "0")}`
    const isChanged =
      changed &&
      ((index >= 0 && index < 20) ||
        (index >= 50 && index < 70) ||
        (index >= 100 && index < 120))
    return {
      name: `${googleAccountName}/${googleLocationName}/reviews/${id}`,
      reviewId: id,
      reviewer: {
        displayName: "Deep reviewer",
        profilePhotoUrl: `https://photos.example.test/${id}.jpg`,
      },
      starRating: "FIVE",
      comment: isChanged ? `Changed body ${id}` : `Original body ${id}`,
      createTime: "2026-08-01T10:00:00.000Z",
      updateTime: new Date(
        Date.parse("2026-09-01T12:00:00.000Z") - index * 60_000
      ).toISOString(),
      // Only the review the erasure test uses carries media, so the guard
      // that skips the media delete/re-insert has something to protect.
      ...(index === 0
        ? {
            reviewMediaItems: [
              {
                mediaFormat: "PHOTO",
                thumbnailUrl: "https://photos.example.test/deep-000-thumb.jpg",
                thumbnailLabel: "Deep media",
              },
            ],
          }
        : {}),
    }
  }

  function pageToken(call: GoogleStubCall) {
    return new URL(call.path, stub.baseUrl).searchParams.get("pageToken")
  }

  function page(call: GoogleStubCall) {
    const token = pageToken(call)
    const start = token === "page-3" ? 100 : token === "page-2" ? 50 : 0
    return {
      status: 200,
      json: {
        reviews: Array.from({ length: 50 }, (_, offset) =>
          review(start + offset)
        ),
        ...(start < 100
          ? { nextPageToken: start === 0 ? "page-2" : "page-3" }
          : {}),
      },
    }
  }

  function sync(path: "backfill" | "reconcile", body: unknown) {
    return fetch(`${server.baseUrl}/api/sync/${path}`, {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    })
  }

  it("reconciles changed reviews beyond the first two pages", async () => {
    const backfill = await sync("backfill", {
      externalLocationIds: [externalLocationId],
      maxPagesPerLocation: 20,
    })
    expect(backfill.status, await backfill.clone().text()).toBe(200)
    const [checkpoint] = await admin<{ high_water_update_time: Date | null }[]>`
      select high_water_update_time
      from sync_checkpoint
      where organisation_id = ${owner.organisationId}
        and external_location_id = ${externalLocationId}
        and sync_type = 'backfill'
    `
    expect(checkpoint.high_water_update_time).toBeInstanceOf(Date)

    changed = true
    stub.calls.length = 0
    const reconcile = await sync("reconcile", {
      externalLocationIds: [externalLocationId],
    })
    expect(reconcile.status, await reconcile.clone().text()).toBe(200)

    const [deepReview] = await admin<{ review_text: string }[]>`
      select review_text
      from review
      where organisation_id = ${owner.organisationId}
        and google_review_id_hash =
          encode(digest('deep-110', 'sha256'), 'hex')
    `
    expect(deepReview.review_text).toBe("Changed body deep-110")
    expect(
      stub.calls.filter(
        (call) => call.method === "GET" && call.path.includes("/reviews")
      )
    ).toHaveLength(3)
  })

  it("never re-ingests a review whose erasure has been fulfilled", async () => {
    const [erased] = await admin<{ id: string }[]>`
      select id::text as id
      from review
      where organisation_id = ${owner.organisationId}
        and google_review_id_hash =
          encode(digest('deep-000', 'sha256'), 'hex')
    `
    expect(erased).toBeDefined()
    const [beforeMedia] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from review_media_item
      where review_id = ${erased.id}
    `
    expect(beforeMedia.count).toBe(1)

    // The erasure branch of PATCH /api/privacy/requests, written directly so
    // this regression does not depend on that route's own test fixtures.
    await admin`
      delete from review_media_item where review_id = ${erased.id}
    `
    await admin`
      update review
      set
        reviewer_display_name = 'Removed reviewer',
        reviewer_profile_photo_url = null,
        review_text = null,
        raw_payload = null,
        erased_at = now()
      where id = ${erased.id}
    `

    // The retention purge nulls the same three columns and sets no marker.
    // Those rows must still be refreshed from the provider, which is why the
    // guard keys on erased_at rather than on "the content is null".
    await admin`
      update review
      set
        review_text = null,
        reviewer_display_name = null,
        raw_payload = null
      where organisation_id = ${owner.organisationId}
        and google_review_id_hash =
          encode(digest('deep-001', 'sha256'), 'hex')
    `

    // Google still serves the review, so the tick re-ingests it: without the
    // erased_at guard the conflict clause writes every one of those fields
    // straight back and re-creates the media rows.
    const reconcile = await sync("reconcile", {
      externalLocationIds: [externalLocationId],
    })
    expect(reconcile.status, await reconcile.clone().text()).toBe(200)

    const [row] = await admin<
      {
        reviewer_display_name: string | null
        reviewer_profile_photo_url: string | null
        review_text: string | null
        raw_payload: unknown
        erased_at: Date | null
      }[]
    >`
      select
        reviewer_display_name,
        reviewer_profile_photo_url,
        review_text,
        raw_payload,
        erased_at
      from review
      where id = ${erased.id}
    `
    expect(row.reviewer_display_name).toBe("Removed reviewer")
    expect(row.reviewer_profile_photo_url).toBeNull()
    expect(row.review_text).toBeNull()
    expect(row.raw_payload).toBeNull()
    expect(row.erased_at).toBeInstanceOf(Date)
    const [media] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from review_media_item
      where review_id = ${erased.id}
    `
    expect(media.count).toBe(0)

    const [live] = await admin<
      { review_text: string | null; reviewer_display_name: string | null }[]
    >`
      select review_text, reviewer_display_name
      from review
      where organisation_id = ${owner.organisationId}
        and google_review_id_hash =
          encode(digest('deep-001', 'sha256'), 'hex')
    `
    expect(live.review_text).toBe("Changed body deep-001")
    expect(live.reviewer_display_name).toBe("Deep reviewer")
  })
})

describeDatabase("reconcile runtime budget within one organisation", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  let owner: Awaited<ReturnType<typeof createTestTenant>>

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    owner = await createTestTenant(admin)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    // One organisation, three locations: the budget check between tenants
    // cannot see this shape at all.
    for (let index = 0; index < 3; index += 1) {
      await seedLinkedReview(admin, {
        organisationId: owner.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
      })
    }
    stub.respond({ method: "GET", pathIncludes: "/reviews" }, (call) => {
      const location =
        call.path.split("/locations/")[1]?.split("/")[0] ?? "unknown"
      return {
        status: 200,
        json: {
          reviews: [
            {
              name: `${connection.googleAccountName}/locations/${location}/reviews/budget-${location}`,
              reviewId: `budget-${location}`,
              reviewer: { displayName: "Budget reviewer" },
              starRating: "FIVE",
              comment: "Budget body",
              createTime: "2026-08-01T10:00:00.000Z",
              updateTime: "2026-09-01T10:00:00.000Z",
            },
          ],
        },
        delayMs: 50,
      }
    })
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      GOOGLE_TIMEOUT_MS: "3000",
      RECONCILE_BUDGET_MS: "1",
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, [owner.organisationId])
    await admin.end()
  })

  it("stops between locations once the budget is spent", async () => {
    const response = await fetch(`${server.baseUrl}/api/sync/reconcile`, {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    })
    expect(response.status, await response.clone().text()).toBe(200)
    const body = (await response.json()) as {
      locations: Array<{ externalLocationId: string }>
    }
    // A tick always makes progress, and never more than that once the budget
    // is gone: the remaining locations wait for the next tick instead of
    // running the caller past its abort.
    expect(body.locations).toHaveLength(1)
    expect(
      stub.calls.filter(
        (call) => call.method === "GET" && call.path.includes("/reviews")
      )
    ).toHaveLength(1)
    const [checkpoints] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from sync_checkpoint
      where organisation_id = ${owner.organisationId}
        and sync_type = 'reconcile'
    `
    expect(checkpoints.count).toBe(1)
  })
})
