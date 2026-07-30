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
    const id = `deep-${String(index).padStart(3, "0")}`
    const isChanged =
      changed &&
      ((index >= 0 && index < 20) ||
        (index >= 50 && index < 70) ||
        (index >= 100 && index < 120))
    return {
      name: `${googleAccountName}/${googleLocationName}/reviews/${id}`,
      reviewId: id,
      reviewer: { displayName: "Deep reviewer" },
      starRating: "FIVE",
      comment: isChanged ? `Changed body ${id}` : `Original body ${id}`,
      createTime: "2026-08-01T10:00:00.000Z",
      updateTime: new Date(
        Date.parse("2026-09-01T12:00:00.000Z") - index * 60_000
      ).toISOString(),
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
    const [checkpoint] = await admin<
      { high_water_update_time: Date | null }[]
    >`
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
})
