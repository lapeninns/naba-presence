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
      dueJobBacklog: 3,
      checkpointFailures24h: 1,
      connectionErrors24h: 1,
      schedulerHeartbeatAt: expect.any(String),
    })
    expect(health.oldestFailedEventAgeSeconds).toBeGreaterThanOrEqual(1_200)
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
    expect(health).toMatchObject({
      scope: "platform",
      failedWebhookEvents: 1,
      deadWebhookEvents: 1,
      ambiguousPublishAttempts: 1,
      schedulerHeartbeatAt: expect.any(String),
    })
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
