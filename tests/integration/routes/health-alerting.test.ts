import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("operations health alerting", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  let organisationId: string
  let ownerCookie: string

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    const owner = await createTestTenant(admin)
    organisationId = owner.organisationId
    ownerCookie = owner.cookie
    const connection = await seedGoogleConnection(admin, { organisationId })
    const linked = await seedLinkedReview(admin, {
      organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    // A second connection, disconnected past its purge date, with a live hold
    // on its only review: the purge cannot proceed and the panel has to say so.
    const heldConnection = await seedGoogleConnection(admin, { organisationId })
    const heldReview = await seedLinkedReview(admin, {
      organisationId,
      connectionId: heldConnection.connectionId,
      googleAccountName: heldConnection.googleAccountName,
    })
    await admin`
      update google_connection
      set status = 'disconnected',
        disconnected_at = now() - interval '30 days',
        purge_due_at = now() - interval '23 days'
      where id = ${heldConnection.connectionId}
    `
    await admin`
      insert into legal_hold (organisation_id, review_id, reason, approved_by)
      values (
        ${organisationId},
        ${heldReview.reviewId},
        'health fixture hold',
        ${owner.userId}
      )
    `
    server = await startAppServer()

    const heartbeatResponse = await fetch(`${server.baseUrl}/api/jobs/run`, {
      method: "POST",
      headers: {
        authorization: "Bearer route-harness-cron-secret",
        "content-type": "application/json",
      },
      body: "{}",
    })
    expect(
      heartbeatResponse.status,
      await heartbeatResponse.clone().text()
    ).toBe(200)

    await admin`
      update google_connection
      set
        status = 'error',
        last_error_code = 'health_fixture',
        refresh_token_expires_at = now() + interval '1 day',
        updated_at = now()
      where id = ${connection.connectionId}
    `
    await admin`
      insert into sync_checkpoint (
        organisation_id,
        external_location_id,
        sync_type,
        status,
        next_attempt_at,
        last_error_code,
        updated_at
      )
      values (
        ${organisationId},
        ${linked.externalLocationId},
        'backfill',
        'failed',
        now() - interval '1 minute',
        'health_fixture',
        now()
      )
    `
    // Three more due checkpoints, one per claimer. Only the backfill row above
    // is claimable by claim_due_jobs; the metrics crons claim 'performance',
    // and nothing at all claims 'notification'. They must be reported apart,
    // not folded into the runner's own backlog.
    await admin`
      insert into sync_checkpoint (
        organisation_id,
        external_location_id,
        sync_type,
        status,
        next_attempt_at,
        updated_at
      )
      values
        (
          ${organisationId},
          ${linked.externalLocationId},
          'performance',
          'failed',
          now() - interval '1 minute',
          now()
        ),
        (
          ${organisationId},
          ${linked.externalLocationId},
          'notification',
          'failed',
          now() - interval '1 minute',
          now()
        )
    `
    // The last SUCCESSFUL reconcile was two hours ago; the one that just
    // failed must not make the location look fresh (finished_at moves on a
    // failure, last_succeeded_at does not).
    await admin`
      insert into sync_checkpoint (
        organisation_id,
        external_location_id,
        sync_type,
        status,
        finished_at,
        last_succeeded_at,
        last_error_code,
        updated_at
      )
      values (
        ${organisationId},
        ${linked.externalLocationId},
        'reconcile',
        'failed',
        now() - interval '1 minute',
        now() - interval '2 hours',
        'google_unavailable',
        now()
      )
    `
    await admin`
      insert into processed_webhook_event (
        organisation_id,
        external_location_id,
        provider,
        external_event_id,
        event_type,
        payload_hash,
        payload,
        status,
        next_attempt_at,
        received_at
      )
      values
        (
          ${organisationId},
          ${linked.externalLocationId},
          'google_pubsub',
          ${randomUUID()},
          'NEW_REVIEW',
          ${randomUUID()},
          '{}'::jsonb,
          'failed',
          now() - interval '1 minute',
          now() - interval '20 minutes'
        ),
        (
          ${organisationId},
          ${linked.externalLocationId},
          'google_pubsub',
          ${randomUUID()},
          'UPDATED_REVIEW',
          ${randomUUID()},
          '{}'::jsonb,
          'dead',
          null,
          now() - interval '5 minutes'
        )
    `
    await admin`
      update review set workflow_status = 'drafted'
      where id = ${linked.reviewId}
    `
    await admin`
      update review set workflow_status = 'verified'
      where id = ${linked.reviewId}
    `
    await admin`
      update review set workflow_status = 'publish_requested'
      where id = ${linked.reviewId}
    `
    const [reply] = await admin<{ id: string }[]>`
      insert into review_reply (
        organisation_id,
        review_id,
        current_body,
        publish_status
      )
      values (
        ${organisationId},
        ${linked.reviewId},
        'Health fixture reply',
        'accepted'
      )
      returning id::text as id
    `
    await admin`
      insert into publish_attempt (
        organisation_id,
        review_reply_id,
        idempotency_key,
        request_body_hash,
        status,
        attempt_no,
        operation,
        intended_body,
        next_attempt_at,
        started_at
      )
      values (
        ${organisationId},
        ${reply.id},
        ${randomUUID()},
        ${randomUUID()},
        'ambiguous',
        1,
        'publish',
        'Health fixture reply',
        now() - interval '1 minute',
        now() - interval '2 minutes'
      )
    `
  })

  afterAll(async () => {
    await server?.stop()
    if (organisationId) await destroyTenants(admin, [organisationId])
    await admin?.end()
  })

  it("reports tenant alert counters and scheduler heartbeat", async () => {
    const response = await fetch(`${server.baseUrl}/api/operations/health`, {
      headers: { cookie: ownerCookie },
    })
    expect(response.status, await response.clone().text()).toBe(200)
    const health = await response.json()
    expect(health).toMatchObject({
      failedWebhookEvents: 1,
      deadWebhookEvents: 1,
      ambiguousPublishAttempts: 1,
      staleStartedAttempts: 0,
      // The backfill, performance and notification checkpoints seeded above.
      // Includes the failed reconcile seeded for the freshness case.
      checkpointFailures24h: 4,
      connectionErrors24h: 1,
      schedulerHeartbeatAt: expect.any(String),
      schedulerHeartbeatStale: false,
    })
    expect(health.oldestFailedEventAgeSeconds).toBeGreaterThanOrEqual(1_200)
  })

  it("attributes the due backlog to the claimer that owes it", async () => {
    const response = await fetch(`${server.baseUrl}/api/operations/health`, {
      headers: { cookie: ownerCookie },
    })
    expect(response.status, await response.clone().text()).toBe(200)
    const health = await response.json()
    expect(health).toMatchObject({
      // One due failed webhook.
      dueWebhookBacklog: 1,
      // The 'backfill' checkpoint, and only that one: this term has to mirror
      // claim_due_jobs, which takes sync_type in ('backfill','sweep').
      dueRunnerCheckpointBacklog: 1,
      // The 'performance' checkpoint, which the metrics cron claims.
      dueMetricsCheckpointBacklog: 1,
      // The 'notification' checkpoint, which nothing claims.
      dueUnclaimedCheckpointBacklog: 1,
      // The ambiguous publish attempt.
      duePublishBacklog: 1,
      // Unnarrowed: the total is still every due item, and is exactly the sum
      // of its parts.
      dueJobBacklog: 5,
    })
    const [claimable] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from sync_checkpoint
      where organisation_id = ${organisationId}
        and status in ('pending', 'failed')
        and next_attempt_at <= now()
        and sync_type in ('backfill', 'sweep')
    `
    expect(health.dueRunnerCheckpointBacklog).toBe(claimable.count)
  })

  it("reports reconcile freshness, blocked purges and expiring grants", async () => {
    const response = await fetch(`${server.baseUrl}/api/operations/health`, {
      headers: { cookie: ownerCookie },
    })
    expect(response.status, await response.clone().text()).toBe(200)
    const health = await response.json()
    expect(health.reconcileStalenessSeconds).toBeGreaterThanOrEqual(7_000)
    expect(health.heldPurgeLocations).toBe(1)
    expect(health.pendingPurgeAgeSeconds).toBeGreaterThanOrEqual(
      22 * 24 * 3_600
    )
    expect(health.refreshTokensExpiringSoon).toBe(1)
  })

  it("reports per-tick liveness, not just the jobs tick", async () => {
    const response = await fetch(`${server.baseUrl}/api/operations/health`, {
      headers: { cookie: ownerCookie },
    })
    expect(response.status, await response.clone().text()).toBe(200)
    const health = await response.json()
    expect(
      health.schedulerTicks.map((tick: { name: string }) => tick.name)
    ).toEqual([
      "jobs",
      "reconcile",
      "retention",
      "performance",
      "keywords",
      "presence-resources",
      "sweep",
    ])
    // beforeAll ran one jobs tick, and its advisory lease stamped the row.
    const jobs = health.schedulerTicks.find(
      (tick: { name: string }) => tick.name === "jobs"
    )
    expect(jobs).toMatchObject({
      lastCompletedAt: expect.any(String),
      stale: false,
      staleAfterSeconds: 300,
    })
  })

  it("supports cron-authenticated platform scope without a browser session", async () => {
    const response = await fetch(
      `${server.baseUrl}/api/operations/health?scope=platform`,
      {
        headers: {
          authorization: "Bearer route-harness-cron-secret",
        },
      }
    )
    expect(response.status, await response.clone().text()).toBe(200)
    const health = await response.json()
    // Platform scope counts every tenant in the database, so these are
    // lower bounds, not equalities: a local database that has also run the
    // e2e journey seed (or is holding a previous run's tenants) legitimately
    // carries more. The tenant-scoped assertions above are the exact ones.
    expect(health.scope).toBe("platform")
    expect(health.schedulerHeartbeatAt).toEqual(expect.any(String))
    expect(health.failedWebhookEvents).toBeGreaterThanOrEqual(1)
    expect(health.deadWebhookEvents).toBeGreaterThanOrEqual(1)
    expect(health.ambiguousPublishAttempts).toBeGreaterThanOrEqual(1)
  })

  it("rejects an invalid platform monitor token", async () => {
    const response = await fetch(
      `${server.baseUrl}/api/operations/health?scope=platform`,
      {
        headers: { authorization: "Bearer wrong-monitor-token" },
      }
    )
    expect(response.status).toBe(401)
  })
})
