import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

type Fixture = {
  owner: Awaited<ReturnType<typeof createTestTenant>>
  connectionId: string
  externalLocationId: string
  reviewId: string
  googleReviewName: string
}

describeDatabase("durable background jobs", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      GOOGLE_TIMEOUT_MS: "2500",
      GOOGLE_MUTATION_TIMEOUT_MS: "2500",
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function fixture(): Promise<Fixture> {
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
    return {
      owner,
      connectionId: connection.connectionId,
      externalLocationId: linked.externalLocationId,
      reviewId: linked.reviewId,
      googleReviewName: linked.googleReviewName,
    }
  }

  function runJobs() {
    return fetch(`${server.baseUrl}/api/jobs/run`, {
      method: "POST",
      headers: {
        authorization: "Bearer route-harness-cron-secret",
        "content-type": "application/json",
      },
      body: "{}",
    })
  }

  function healthyReviews() {
    stub.reset()
    stub.respond(
      { method: "GET", pathIncludes: "/reviews" },
      () => ({ status: 200, json: { reviews: [] } })
    )
  }

  async function seedWebhook(
    subject: Fixture,
    retryCount: number
  ) {
    const [event] = await admin<{ id: string }[]>`
      insert into processed_webhook_event (
        organisation_id,
        external_location_id,
        provider,
        external_event_id,
        event_type,
        payload_hash,
        payload,
        status,
        retry_count,
        next_attempt_at
      )
      values (
        ${subject.owner.organisationId},
        ${subject.externalLocationId},
        'google_pubsub',
        ${randomUUID()},
        'NEW_REVIEW',
        ${randomUUID()},
        '{}'::jsonb,
        'failed',
        ${retryCount},
        now() - interval '1 second'
      )
      returning id::text as id
    `
    return event.id
  }

  async function seedPublishAttempt(
    subject: Fixture,
    status: "started" | "retryable",
    body: string
  ) {
    await admin`
      update review set workflow_status = 'drafted'
      where id = ${subject.reviewId}
    `
    await admin`
      update review set workflow_status = 'verified'
      where id = ${subject.reviewId}
    `
    await admin`
      update review set workflow_status = 'publish_requested'
      where id = ${subject.reviewId}
    `
    const [reply] = await admin<{ id: string }[]>`
      insert into review_reply (
        organisation_id,
        review_id,
        current_body,
        publish_status
      )
      values (
        ${subject.owner.organisationId},
        ${subject.reviewId},
        ${body},
        'accepted'
      )
      returning id::text as id
    `
    const [attempt] = await admin<{ id: string }[]>`
      insert into publish_attempt (
        organisation_id,
        review_reply_id,
        idempotency_key,
        request_body_hash,
        status,
        attempt_no,
        operation,
        intended_body,
        started_at,
        next_attempt_at
      )
      values (
        ${subject.owner.organisationId},
        ${reply.id},
        ${randomUUID()},
        ${randomUUID()},
        ${status},
        1,
        'publish',
        ${body},
        ${
          status === "started"
            ? new Date(Date.now() - 15 * 60_000)
            : new Date()
        },
        ${status === "retryable"
          ? new Date(Date.now() - 1_000)
          : null}
      )
      returning id::text as id
    `
    return attempt.id
  }

  it("retries a failed webhook event and marks it processed", async () => {
    const subject = await fixture()
    healthyReviews()
    const eventId = await seedWebhook(subject, 1)

    const response = await runJobs()
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ webhooks: 1 })
    const [event] = await admin<
      { status: string; retry_count: number }[]
    >`
      select status, retry_count
      from processed_webhook_event
      where id = ${eventId}
    `
    expect(event).toEqual({ status: "processed", retry_count: 2 })
  })

  it("dead-letters a webhook event after five attempts", async () => {
    const subject = await fixture()
    healthyReviews()
    const eventId = await seedWebhook(subject, 5)

    const response = await runJobs()
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ dead: 1 })
    const [event] = await admin<{ status: string }[]>`
      select status
      from processed_webhook_event
      where id = ${eventId}
    `
    expect(event.status).toBe("dead")
    const [audit] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from audit_log
      where organisation_id = ${subject.owner.organisationId}
        and action = 'webhook.dead_lettered'
        and subject_id = ${eventId}
    `
    expect(audit.count).toBe(1)
  })

  it("continues a pending backfill checkpoint headlessly", async () => {
    const subject = await fixture()
    stub.reset()
    stub.respond(
      { method: "GET", pathIncludes: "/reviews" },
      () => ({ status: 200, json: { reviews: [] } })
    )
    await admin`
      insert into sync_checkpoint (
        organisation_id,
        external_location_id,
        sync_type,
        status,
        page_token,
        next_attempt_at
      )
      values (
        ${subject.owner.organisationId},
        ${subject.externalLocationId},
        'backfill',
        'pending',
        'A3',
        now() - interval '1 second'
      )
    `

    const response = await runJobs()
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ checkpoints: 1 })
    expect(stub.calls.some((call) => call.path.includes("pageToken=A3"))).toBe(
      true
    )
    const [checkpoint] = await admin<{ status: string }[]>`
      select status
      from sync_checkpoint
      where organisation_id = ${subject.owner.organisationId}
        and external_location_id = ${subject.externalLocationId}
        and sync_type = 'backfill'
    `
    expect(checkpoint.status).toBe("succeeded")
  })

  it("settles a stale started publish attempt via read-back", async () => {
    const subject = await fixture()
    const body = "A durable reply already visible at Google."
    const attemptId = await seedPublishAttempt(subject, "started", body)
    stub.reset()
    stub.respond(
      { method: "GET", pathIncludes: "/reviews/" },
      () => ({
        status: 200,
        json: {
          reviewId: "stub",
          reviewReply: {
            comment: body,
            updateTime: "2026-08-20T10:00:00.000Z",
          },
        },
      })
    )

    const response = await runJobs()
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ attempts: 1 })
    const [attempt] = await admin<{ status: string }[]>`
      select status from publish_attempt where id = ${attemptId}
    `
    expect(attempt.status).toBe("succeeded")
  })

  it("retries a retryable publish attempt without a human", async () => {
    const subject = await fixture()
    const body = "A durable background retry."
    const attemptId = await seedPublishAttempt(subject, "retryable", body)
    stub.reset()
    stub.respond(
      { method: "PUT", pathIncludes: "/reply" },
      () => ({
        status: 200,
        json: {
          comment: body,
          updateTime: "2026-08-20T10:00:00.000Z",
        },
      })
    )

    const response = await runJobs()
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ attempts: 1 })
    const [attempt] = await admin<{ status: string }[]>`
      select status from publish_attempt where id = ${attemptId}
    `
    expect(attempt.status).toBe("succeeded")
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(1)
  })

  it("claims work exclusively with skip locked", async () => {
    const subject = await fixture()
    healthyReviews()
    await seedWebhook(subject, 1)

    const responses = await Promise.all([runJobs(), runJobs()])
    expect(responses.every((response) => response.status === 200)).toBe(true)
    const summaries = await Promise.all(
      responses.map(
        (response) =>
          response.json() as Promise<{ webhooks: number }>
      )
    )
    expect(summaries.reduce((sum, item) => sum + item.webhooks, 0)).toBe(1)
  })
})
