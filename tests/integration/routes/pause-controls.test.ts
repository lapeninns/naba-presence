import postgres from "postgres"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedAwaitingApprovalPost,
  seedGoogleConnection,
  seedLinkedReview,
  seedMemberUser,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

// The app caches the pause table for PAUSE_CACHE_TTL_MS (5s,
// lib/server/pause-controls.ts); wait past it after each change.
const PAUSE_PROPAGATION_MS = 5_300
const settle = () =>
  new Promise((resolve) => setTimeout(resolve, PAUSE_PROPAGATION_MS))

const CRON = { authorization: "Bearer route-harness-cron-secret" }

describeDatabase("operator pause controls (0071)", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  const touched = new Set<string>()

  async function setPause(scope: string, paused: boolean) {
    touched.add(scope)
    await admin`
      select * from set_ops_pause(
        ${scope}, ${paused}, 'Integration test pause', 'pause-controls.test'
      )
    `
  }

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      GBP_PLACE_ACTIONS_ENABLED: "true",
      GBP_POSTS_ENABLED: "true",
      PUBLISH_ENABLED: "true",
    })
  })

  afterEach(async () => {
    // The table is platform-wide: never leave a pause behind for another
    // suite sharing the database.
    for (const scope of touched) await setPause(scope, false)
    touched.clear()
    await settle()
  }, 20_000)

  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("refuses a Google write at dispatch while publish is paused, sending and writing nothing", async () => {
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
    google.reset()
    google.respond(
      { method: "GET", pathIncludes: "/placeActionLinks" },
      () => ({ status: 200, json: { placeActionLinks: [] } })
    )

    await setPause("publish", true)
    await settle()

    const response = await fetch(
      `${server.baseUrl}/api/locations/${linked.locationId}/place-actions`,
      {
        method: "POST",
        headers: {
          cookie: owner.cookie,
          "content-type": "application/json",
          "x-request-id": "paused-create",
        },
        body: JSON.stringify({
          confirmation: "create_google_place_action",
          uri: "https://book.example.com/paused",
          placeActionType: "DINING_RESERVATION",
          isPreferred: true,
        }),
      }
    )
    expect(response.status, await response.clone().text()).toBe(503)
    expect(await response.json()).toMatchObject({
      error: "place_actions_paused",
      details: { pausedScopes: ["publish"], pauseStateUnknown: false },
    })
    expect(google.calls.filter((call) => call.method === "POST")).toEqual([])
    const audits = await admin`
      select 1 from audit_log
      where organisation_id = ${owner.organisationId}
        and action like 'place_action%'
    `
    expect(audits).toHaveLength(0)

    // Lifting the pause lets the same request through without a redeploy.
    await setPause("publish", false)
    await settle()
    google.respond(
      { method: "POST", pathIncludes: "/placeActionLinks" },
      (call) => ({
        status: 200,
        json: {
          name: `${linked.googleLocationName}/placeActionLinks/merchant`,
          providerType: "MERCHANT",
          isEditable: true,
          ...(call.body as Record<string, unknown>),
        },
      })
    )
    google.respond(
      { method: "GET", pathIncludes: "/placeActionLinks/merchant" },
      () => ({
        status: 200,
        json: {
          name: `${linked.googleLocationName}/placeActionLinks/merchant`,
          providerType: "MERCHANT",
          isEditable: true,
          uri: "https://book.example.com/paused",
          placeActionType: "DINING_RESERVATION",
          isPreferred: true,
        },
      })
    )
    const resumed = await fetch(
      `${server.baseUrl}/api/locations/${linked.locationId}/place-actions`,
      {
        method: "POST",
        headers: {
          cookie: owner.cookie,
          "content-type": "application/json",
          "x-request-id": "resumed-create",
        },
        body: JSON.stringify({
          confirmation: "create_google_place_action",
          uri: "https://book.example.com/paused",
          placeActionType: "DINING_RESERVATION",
          isPreferred: true,
        }),
      }
    )
    expect(resumed.status, await resumed.clone().text()).toBe(201)
  }, 60_000)

  async function linkedOwner() {
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
    return { owner, linked }
  }

  it("refuses an owner backfill while sync is paused, reading nothing from Google", async () => {
    const { owner } = await linkedOwner()
    google.reset()
    await setPause("sync", true)
    await settle()

    const response = await fetch(`${server.baseUrl}/api/sync/backfill`, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(response.status, await response.clone().text()).toBe(503)
    expect(await response.json()).toMatchObject({
      error: "sync_paused",
      details: { pausedScopes: ["sync"], pauseStateUnknown: false },
    })
    expect(google.calls).toEqual([])
    const audits = await admin`
      select 1 from audit_log
      where organisation_id = ${owner.organisationId}
        and action = 'sync.backfill.started'
    `
    expect(audits).toHaveLength(0)
  }, 60_000)

  it("refuses a reply publish and approval while publish is paused, recording nothing", async () => {
    const { owner, linked } = await linkedOwner()
    google.reset()
    await setPause("publish", true)
    await settle()

    const publish = await fetch(
      `${server.baseUrl}/api/reviews/${linked.reviewId}/publish`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          draftId: "00000000-0000-4000-8000-000000000001",
          expectedReviewUpdateTime: "2026-10-10T00:00:00Z",
        }),
      }
    )
    expect(publish.status, await publish.clone().text()).toBe(503)
    expect(await publish.json()).toMatchObject({
      error: "publishing_paused",
      details: { pausedScopes: ["publish"] },
    })

    const approval = await fetch(
      `${server.baseUrl}/api/reviews/${linked.reviewId}/approval`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ decision: "approve" }),
      }
    )
    expect(approval.status, await approval.clone().text()).toBe(503)
    expect(await approval.json()).toMatchObject({
      error: "publishing_paused",
      details: { pausedScopes: ["publish"] },
    })

    expect(google.calls.filter((call) => call.method === "PUT")).toEqual([])
    const written = await admin`
      select
        (select count(*)::int from approval_decision
          where organisation_id = ${owner.organisationId}) as decisions,
        (select count(*)::int from publish_attempt
          where organisation_id = ${owner.organisationId}) as attempts
    `
    expect(written[0]).toEqual({ decisions: 0, attempts: 0 })
  }, 60_000)

  it("refuses a post approval while posts is paused, leaving no decision behind", async () => {
    const { owner, linked } = await linkedOwner()
    const member = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      role: "member",
      assignLocationId: linked.locationId,
    })
    const post = await seedAwaitingApprovalPost(admin, {
      organisationId: owner.organisationId,
      locationId: linked.locationId,
      requestedBy: member.userId,
    })
    google.reset()
    await setPause("posts", true)
    await settle()

    const response = await fetch(
      `${server.baseUrl}/api/locations/${linked.locationId}/posts/${post.id}/approval`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ decision: "approve", expectedRevision: 1 }),
      }
    )
    expect(response.status, await response.clone().text()).toBe(503)
    expect(await response.json()).toMatchObject({
      error: "publishing_paused",
      details: { pausedScopes: ["posts"] },
    })
    expect(google.calls).toEqual([])
    const [state] = await admin<
      { status: string; decisions: number; audits: number }[]
    >`
      select
        (select status from gbp_local_post where id = ${post.id}) as status,
        (select count(*)::int from post_approval_decision
          where post_id = ${post.id}) as decisions,
        (select count(*)::int from audit_log
          where organisation_id = ${owner.organisationId}
            and action = 'post.approval.approved') as audits
    `
    expect(state).toEqual({
      status: "awaiting_approval",
      decisions: 0,
      audits: 0,
    })
  }, 60_000)

  it("pauses retention and reports the tick as paused, not dead", async () => {
    await setPause("retention", true)
    await settle()

    const response = await fetch(`${server.baseUrl}/api/cron/retention`, {
      method: "POST",
      headers: CRON,
    })
    expect(response.status, await response.clone().text()).toBe(503)
    expect(await response.json()).toMatchObject({
      error: "retention_paused",
      details: { pausedScopes: ["retention"] },
    })

    const health = await fetch(
      `${server.baseUrl}/api/operations/health?scope=platform`,
      { headers: CRON }
    )
    expect(health.status, await health.clone().text()).toBe(200)
    const ticks = (await health.json()).schedulerTicks as Array<{
      name: string
      paused: boolean
      pausedScopes: string[]
    }>
    expect(ticks.find((tick) => tick.name === "retention")).toMatchObject({
      paused: true,
      pausedScopes: ["retention"],
    })
    expect(ticks.find((tick) => tick.name === "jobs")).toMatchObject({
      paused: false,
    })
  }, 60_000)

  it("pauses the health tick through the notifications scope", async () => {
    await setPause("notifications", true)
    await settle()
    const response = await fetch(`${server.baseUrl}/api/cron/health`, {
      method: "POST",
      headers: CRON,
    })
    expect(response.status, await response.clone().text()).toBe(503)
    expect(await response.json()).toMatchObject({
      error: "notifications_paused",
    })
  }, 60_000)

  it("keeps the runtime role from lifting a pause", async () => {
    const runtimeUrl = process.env.DATABASE_URL!
    const runtime = postgres(runtimeUrl, { max: 1 })
    try {
      expect(
        (await runtime`select scope from ops_pause_control`).length
      ).toBeGreaterThan(0)
      await expect(
        runtime`update ops_pause_control set paused = false`
      ).rejects.toMatchObject({ code: "42501" })
      await expect(
        runtime`select * from set_ops_pause('publish', false, 'nope', 'runtime')`
      ).rejects.toMatchObject({ code: "42501" })
      await expect(
        runtime`insert into organisation_feature (organisation_id, feature) values (gen_random_uuid(), 'post_scheduling')`
      ).rejects.toMatchObject({ code: "42501" })
    } finally {
      await runtime.end()
    }
  })
})
