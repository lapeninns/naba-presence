import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
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

type EventRow = {
  status: string
  retry_count: number
  processed_at: Date | null
  last_error_code: string | null
  lease_expires_at: Date | null
  next_attempt_at: Date | null
  due: boolean
}

/**
 * NP1-G02 / NP8-G03: POST /api/webhooks/google/pubsub/replay is the
 * operator's dead-letter recovery path (runbook). It re-queues one failed or
 * dead-lettered event of the caller's organisation for the job runner,
 * owner and admin only, and honours the sync kill switch before reading
 * the body.
 */
describeDatabase("webhook replay", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  let owner: Awaited<ReturnType<typeof createTestTenant>>
  let other: Awaited<ReturnType<typeof createTestTenant>>
  let member: { cookie: string }
  let viewer: { cookie: string }
  let externalLocationId: string
  let otherExternalLocationId: string
  let paused = false

  async function seedEvent(input: {
    organisationId: string
    externalLocationId: string | null
    status: string
    retryCount?: number
  }) {
    const id = randomUUID()
    await admin`
      insert into processed_webhook_event (
        id,
        organisation_id,
        external_location_id,
        provider,
        external_event_id,
        event_type,
        payload_hash,
        status,
        retry_count,
        processed_at,
        last_error_code,
        lease_expires_at,
        next_attempt_at
      )
      values (
        ${id},
        ${input.organisationId},
        ${input.externalLocationId},
        'google_pubsub',
        ${randomUUID()},
        'NEW_REVIEW',
        ${randomUUID()},
        ${input.status},
        ${input.retryCount ?? 5},
        now() - interval '1 hour',
        'google_unavailable',
        ${input.status === "processing" ? admin`now() + interval '5 minutes'` : null},
        ${input.status === "dead" ? null : admin`now() + interval '1 day'`}
      )
    `
    return id
  }

  async function readEvent(id: string) {
    const [row] = await admin<EventRow[]>`
      select
        status,
        retry_count,
        processed_at,
        last_error_code,
        lease_expires_at,
        next_attempt_at,
        next_attempt_at <= now() as due
      from processed_webhook_event
      where id = ${id}
    `
    return row
  }

  async function replayAudits(organisationId: string, eventId: string) {
    return admin`
      select actor_user_id::text as actor
      from audit_log
      where organisation_id = ${organisationId}
        and action = 'webhook.replay.requested'
        and subject_id = ${eventId}
    `
  }

  const replay = (cookie: string | undefined, eventId: string) =>
    fetch(`${server.baseUrl}/api/webhooks/google/pubsub/replay`, {
      method: "POST",
      headers: {
        ...(cookie ? { cookie } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify({ eventId }),
    })

  async function setSyncPause(value: boolean) {
    paused = value
    await admin`
      select * from set_ops_pause(
        'sync', ${value}, 'Integration test pause', 'webhook-replay.test'
      )
    `
    await settle()
  }

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    owner = await createTestTenant(admin)
    other = await createTestTenant(admin)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    externalLocationId = linked.externalLocationId
    const otherConnection = await seedGoogleConnection(admin, {
      organisationId: other.organisationId,
    })
    const otherLinked = await seedLinkedReview(admin, {
      organisationId: other.organisationId,
      connectionId: otherConnection.connectionId,
      googleAccountName: otherConnection.googleAccountName,
    })
    otherExternalLocationId = otherLinked.externalLocationId
    member = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      role: "member",
    })
    viewer = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      role: "viewer",
    })
    server = await startAppServer()
  })

  afterEach(async () => {
    // The pause table is platform-wide: never leave sync paused for the
    // next suite sharing the database.
    if (paused) await setSyncPause(false)
  }, 20_000)

  afterAll(async () => {
    await server?.stop()
    await destroyTenants(admin, [owner.organisationId, other.organisationId])
    await admin.end()
  })

  it("re-queues an owner's dead-lettered event for the runner and audits it", async () => {
    const eventId = await seedEvent({
      organisationId: owner.organisationId,
      externalLocationId,
      status: "dead",
    })

    const response = await replay(owner.cookie, eventId)

    expect(response.status, await response.clone().text()).toBe(202)
    expect(await response.json()).toEqual({ status: "scheduled", eventId })
    expect(await readEvent(eventId)).toMatchObject({
      status: "failed",
      retry_count: 0,
      processed_at: null,
      last_error_code: null,
      lease_expires_at: null,
      due: true,
    })
    expect(await replayAudits(owner.organisationId, eventId)).toEqual([
      { actor: owner.userId },
    ])
  })

  it("re-queues a failed event that was waiting for its back-off", async () => {
    const eventId = await seedEvent({
      organisationId: owner.organisationId,
      externalLocationId,
      status: "failed",
      retryCount: 2,
    })

    const response = await replay(owner.cookie, eventId)

    expect(response.status, await response.clone().text()).toBe(202)
    expect(await readEvent(eventId)).toMatchObject({
      status: "failed",
      retry_count: 0,
      due: true,
    })
  })

  it("answers 404 for another organisation's event and leaves it untouched", async () => {
    const eventId = await seedEvent({
      organisationId: other.organisationId,
      externalLocationId: otherExternalLocationId,
      status: "dead",
    })
    const before = await readEvent(eventId)

    const response = await replay(owner.cookie, eventId)

    expect(response.status, await response.clone().text()).toBe(404)
    expect(await response.json()).toMatchObject({
      error: "replay_event_not_found",
    })
    expect(await readEvent(eventId)).toEqual(before)
    expect(await replayAudits(owner.organisationId, eventId)).toEqual([])
    expect(await replayAudits(other.organisationId, eventId)).toEqual([])
  })

  it("refuses a running or settled event with 404", async () => {
    for (const status of ["processing", "processed"]) {
      const eventId = await seedEvent({
        organisationId: owner.organisationId,
        externalLocationId,
        status,
      })
      const before = await readEvent(eventId)

      const response = await replay(owner.cookie, eventId)

      expect(response.status, status).toBe(404)
      expect(await response.json()).toMatchObject({
        error: "replay_event_not_found",
      })
      expect(await readEvent(eventId)).toEqual(before)
    }
  })

  it("rolls the claim back with 409 when the event's location is no longer linked", async () => {
    const eventId = await seedEvent({
      organisationId: owner.organisationId,
      externalLocationId: null,
      status: "dead",
    })
    const before = await readEvent(eventId)

    const response = await replay(owner.cookie, eventId)

    expect(response.status, await response.clone().text()).toBe(409)
    expect(await response.json()).toMatchObject({
      error: "location_not_linked",
    })
    expect(await readEvent(eventId)).toEqual(before)
    expect(await replayAudits(owner.organisationId, eventId)).toEqual([])
  })

  it("refuses members, viewers and anonymous callers", async () => {
    const eventId = await seedEvent({
      organisationId: owner.organisationId,
      externalLocationId,
      status: "dead",
    })
    const before = await readEvent(eventId)

    for (const [who, cookie, status] of [
      ["member", member.cookie, 403],
      ["viewer", viewer.cookie, 403],
      ["anonymous", undefined, 401],
    ] as const) {
      const response = await replay(cookie, eventId)
      expect(response.status, who).toBe(status)
    }
    expect(await readEvent(eventId)).toEqual(before)
    expect(await replayAudits(owner.organisationId, eventId)).toEqual([])
  })

  it("answers 503 while review sync is paused and re-queues nothing", async () => {
    const eventId = await seedEvent({
      organisationId: owner.organisationId,
      externalLocationId,
      status: "dead",
    })
    const before = await readEvent(eventId)
    await setSyncPause(true)

    const response = await replay(owner.cookie, eventId)

    expect(response.status, await response.clone().text()).toBe(503)
    expect(await response.json()).toMatchObject({
      error: "sync_paused",
      details: { pausedScopes: ["sync"], pauseStateUnknown: false },
    })
    expect(await readEvent(eventId)).toEqual(before)
    expect(await replayAudits(owner.organisationId, eventId)).toEqual([])
  }, 30_000)
})
