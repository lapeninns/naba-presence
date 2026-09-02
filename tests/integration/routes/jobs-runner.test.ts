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

/** Both mirror the ceilings in lib/server/jobs.ts. */
const WEBHOOK_MAX_RETRIES = 5
const MAX_RECOVERY_ATTEMPTS = 8

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

  function runJobs(baseUrl: string = server.baseUrl) {
    return fetch(`${baseUrl}/api/jobs/run`, {
      method: "POST",
      headers: {
        authorization: "Bearer route-harness-cron-secret",
        "content-type": "application/json",
      },
      body: "{}",
    })
  }

  async function runTick(baseUrl?: string) {
    const response = await runJobs(baseUrl)
    expect(response.status, await response.clone().text()).toBe(200)
    return response
  }

  async function webhookState(eventId: string) {
    const [event] = await admin<
      {
        status: string
        retryCount: number
        claimCount: number
        nextAttemptAt: Date | null
      }[]
    >`
      select
        status,
        retry_count as "retryCount",
        claim_count as "claimCount",
        next_attempt_at as "nextAttemptAt"
      from processed_webhook_event
      where id = ${eventId}
    `
    return event
  }

  async function attemptState(attemptId: string) {
    const [attempt] = await admin<
      {
        status: string
        providerErrorCode: string | null
        recoveryAttempts: number
        nextAttemptAt: Date | null
        leaseExpiresAt: Date | null
        gapMs: number | null
      }[]
    >`
      select
        status,
        provider_error_code as "providerErrorCode",
        recovery_attempts as "recoveryAttempts",
        next_attempt_at as "nextAttemptAt",
        lease_expires_at as "leaseExpiresAt",
        (extract(epoch from (next_attempt_at - now())) * 1000)::int as "gapMs"
      from publish_attempt
      where id = ${attemptId}
    `
    return attempt
  }

  /** Pulls a back-off forward instead of sleeping it out. */
  async function makeAttemptDue(attemptId: string, recoveryAttempts: number) {
    await admin`
      update publish_attempt
      set
        recovery_attempts = ${recoveryAttempts},
        next_attempt_at = now() - interval '1 second'
      where id = ${attemptId}
    `
  }

  function healthyReviews() {
    stub.reset()
    stub.respond({ method: "GET", pathIncludes: "/reviews" }, () => ({
      status: 200,
      json: { reviews: [] },
    }))
  }

  async function seedWebhook(subject: Fixture, retryCount: number) {
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
    status: "started" | "retryable" | "ambiguous",
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
          status === "retryable"
            ? new Date()
            : new Date(Date.now() - 15 * 60_000)
        },
        ${status === "started" ? null : new Date(Date.now() - 1_000)}
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
    // The claim counts the claim; retry_count is the failure budget and this
    // event never failed, so it stays where it was seeded.
    expect(await webhookState(eventId)).toMatchObject({
      status: "processed",
      retryCount: 1,
      claimCount: 1,
    })
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
    stub.respond({ method: "GET", pathIncludes: "/reviews" }, () => ({
      status: 200,
      json: { reviews: [] },
    }))
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
    stub.respond({ method: "GET", pathIncludes: "/reviews/" }, () => ({
      status: 200,
      json: {
        reviewId: "stub",
        reviewReply: {
          comment: body,
          updateTime: "2026-08-20T10:00:00.000Z",
        },
      },
    }))

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
    stub.respond({ method: "PUT", pathIncludes: "/reply" }, () => ({
      status: 200,
      json: {
        comment: body,
        updateTime: "2026-08-20T10:00:00.000Z",
      },
    }))

    const response = await runJobs()
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ attempts: 1 })
    const [attempt] = await admin<{ status: string }[]>`
      select status from publish_attempt where id = ${attemptId}
    `
    expect(attempt.status).toBe("succeeded")
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(1)
  })

  it("reclaims a webhook stranded in processing by a crashed worker", async () => {
    const subject = await fixture()
    healthyReviews()
    const eventId = await seedWebhook(subject, 1)
    // A worker claimed this and died before settling it. Before leases the
    // row was unreachable forever: every claim predicate matches 'failed'.
    await admin`
      update processed_webhook_event
      set status = 'processing',
          next_attempt_at = null,
          lease_expires_at = now() - interval '1 minute'
      where id = ${eventId}
    `

    const response = await runJobs()
    expect(response.status, await response.clone().text()).toBe(200)
    const [event] = await admin<
      { status: string; lease_expires_at: Date | null }[]
    >`
      select status, lease_expires_at
      from processed_webhook_event
      where id = ${eventId}
    `
    expect(event.status).toBe("processed")
    expect(event.lease_expires_at).toBeNull()
  })

  it("reclaims a checkpoint stranded in running by a crashed worker", async () => {
    const subject = await fixture()
    healthyReviews()
    await admin`
      insert into sync_checkpoint (
        organisation_id,
        external_location_id,
        sync_type,
        status,
        started_at,
        next_attempt_at,
        lease_expires_at
      )
      values (
        ${subject.owner.organisationId},
        ${subject.externalLocationId},
        'backfill',
        'running',
        now() - interval '1 hour',
        null,
        now() - interval '1 minute'
      )
    `

    const response = await runJobs()
    expect(response.status, await response.clone().text()).toBe(200)
    const [checkpoint] = await admin<{ status: string }[]>`
      select status
      from sync_checkpoint
      where organisation_id = ${subject.owner.organisationId}
        and external_location_id = ${subject.externalLocationId}
        and sync_type = 'backfill'
    `
    expect(checkpoint.status).toBe("succeeded")
  })

  it("cancels a claimed checkpoint whose location is no longer linked", async () => {
    const subject = await fixture()
    healthyReviews()
    await admin`
      insert into sync_checkpoint (
        organisation_id,
        external_location_id,
        sync_type,
        status,
        next_attempt_at
      )
      values (
        ${subject.owner.organisationId},
        ${subject.externalLocationId},
        'backfill',
        'pending',
        now() - interval '1 second'
      )
    `
    // syncLinkedLocation gives up before it touches the checkpoint when the
    // link is gone, so the claim's 'running' used to survive the run and be
    // re-armed by the reaper every fifteen minutes for ever.
    await admin`
      update location_link
      set is_active = false
      where external_location_id = ${subject.externalLocationId}
    `

    await runTick()
    const [checkpoint] = await admin<
      {
        status: string
        lastErrorCode: string | null
        nextAttemptAt: Date | null
      }[]
    >`
      select
        status,
        last_error_code as "lastErrorCode",
        next_attempt_at as "nextAttemptAt"
      from sync_checkpoint
      where organisation_id = ${subject.owner.organisationId}
        and external_location_id = ${subject.externalLocationId}
        and sync_type = 'backfill'
    `
    expect(checkpoint).toMatchObject({
      status: "cancelled",
      lastErrorCode: "location_not_linked",
    })
    expect(checkpoint.nextAttemptAt).toBeNull()
  }, 20_000)

  it("spends the webhook retry budget on failures, not on claims", async () => {
    const subject = await fixture()
    const eventId = await seedWebhook(subject, 0)
    stub.reset()
    stub.respond({ method: "GET", pathIncludes: "/reviews" }, () => ({
      status: 500,
      json: { error: { status: "INTERNAL" } },
    }))

    const states: Awaited<ReturnType<typeof webhookState>>[] = []
    for (let tick = 0; tick <= WEBHOOK_MAX_RETRIES; tick += 1) {
      await runTick()
      const state = await webhookState(eventId)
      states.push(state)
      if (state.status === "dead") break
      expect(state.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now())
      await admin`
        update processed_webhook_event
        set next_attempt_at = now() - interval '1 second'
        where id = ${eventId}
      `
    }

    // Every claim here fails, so the two counters must stay in step: no
    // failure counted twice, and none of them missed.
    for (const state of states) {
      expect(state.retryCount).toBe(state.claimCount)
    }
    // One retry per observed failure, and terminal within the budget rather
    // than whenever a tick happened to run out of time.
    expect(states.map((state) => state.retryCount)).toEqual([1, 2, 3, 4, 5])
    expect(states.map((state) => state.status)).toEqual([
      "failed",
      "failed",
      "failed",
      "failed",
      "dead",
    ])
    const [audit] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from audit_log
      where organisation_id = ${subject.owner.organisationId}
        and action = 'webhook.dead_lettered'
        and subject_id = ${eventId}
    `
    expect(audit.count).toBe(1)
  }, 60_000)

  it("backs off an unreadable recovery and dead-letters it at the ceiling", async () => {
    const subject = await fixture()
    const attemptId = await seedPublishAttempt(
      subject,
      "ambiguous",
      "A reply Google will not confirm."
    )
    stub.reset()
    stub.respond({ method: "GET", pathIncludes: "/reviews/" }, () => ({
      status: 404,
      json: { error: { status: "NOT_FOUND" } },
    }))
    const readbacks = () =>
      stub.calls.filter((call) => call.path.includes(subject.googleReviewName))
        .length

    await runTick()
    const first = await attemptState(attemptId)
    expect(first).toMatchObject({ status: "ambiguous", recoveryAttempts: 1 })
    expect(first.gapMs).toBeGreaterThan(0)

    // The delay grows with the counter: a later attempt waits materially
    // longer than the first one did, which the old hardcoded retryDelayMs(1)
    // never managed.
    await makeAttemptDue(attemptId, 5)
    await runTick()
    const later = await attemptState(attemptId)
    expect(later.recoveryAttempts).toBe(6)
    expect(later.gapMs).toBeGreaterThan(first.gapMs!)

    await makeAttemptDue(attemptId, MAX_RECOVERY_ATTEMPTS - 1)
    await runTick()
    const exhausted = await attemptState(attemptId)
    expect(exhausted).toMatchObject({
      status: "failed",
      providerErrorCode: "recovery_exhausted",
      recoveryAttempts: MAX_RECOVERY_ATTEMPTS,
    })
    expect(exhausted.nextAttemptAt).toBeNull()
    const [trail] = await admin<{ audits: number; events: number }[]>`
      select
        (
          select count(*)
          from audit_log
          where organisation_id = ${subject.owner.organisationId}
            and action = 'review.reply.recovery_exhausted'
            and subject_id = ${subject.reviewId}
        )::int as audits,
        (
          select count(*)
          from publish_attempt_event
          where publish_attempt_id = ${attemptId}
            and event_type = 'completed'
        )::int as events
    `
    expect(trail).toEqual({ audits: 1, events: 1 })

    // Terminal means terminal: the next tick must not read Google again.
    const before = readbacks()
    await runTick()
    expect(readbacks()).toBe(before)
  }, 30_000)

  it("parks a reconnect-blocked recovery without spending its budget", async () => {
    const subject = await fixture()
    const attemptId = await seedPublishAttempt(
      subject,
      "ambiguous",
      "A reply waiting on a human to reconnect."
    )
    stub.reset()
    // No grant, so the readback cannot even ask for a token. That is a person
    // to chase rather than a provider verdict, and dead-lettering the reply
    // over it would punish the tenant for the length of their own outage.
    await admin`
      update google_connection
      set status = 'revoked'
      where id = ${subject.connectionId}
    `

    await runTick()
    const parked = await attemptState(attemptId)
    expect(parked).toMatchObject({
      status: "ambiguous",
      providerErrorCode: "reconnect_blocked",
      recoveryAttempts: 0,
    })
    expect(parked.gapMs).toBeGreaterThan(60_000)
  }, 30_000)

  it("claims only the kinds the kill switches leave enabled", async () => {
    const subject = await fixture()
    const attemptId = await seedPublishAttempt(
      subject,
      "ambiguous",
      "A reply nobody may publish right now."
    )
    const eventId = await seedWebhook(subject, 0)
    const before = await attemptState(attemptId)

    // Claim directly with the filter the runner derives from the flags. The
    // switch has to bite here rather than inside runJob: a claimed row is
    // already leased, so claiming and skipping would re-arm it every tick.
    const claimed = await admin<{ kind: string; jobId: string }[]>`
      select kind, job_id::text as "jobId"
      from claim_due_jobs(
        10, 60, 5,
        array['webhook', 'webhook_dead', 'checkpoint']::text[]
      )
    `
    expect(claimed.map((row) => row.jobId)).toContain(eventId)
    expect(claimed.some((row) => row.kind === "recover")).toBe(false)
    const after = await attemptState(attemptId)
    expect(after.nextAttemptAt).toEqual(before.nextAttemptAt)
    expect(after.leaseExpiresAt).toBeNull()

    // This test claims without settling and leaves a due attempt nothing
    // will pick up, so drop both rather than leaving work for the next tick.
    await admin`
      delete from processed_webhook_event where id = ${eventId}
    `
    await admin`delete from publish_attempt where id = ${attemptId}`
  })

  it("caps how much of one batch a single tenant can take", async () => {
    const busy = await fixture()
    const quiet = await fixture()
    for (let index = 0; index < 6; index += 1) {
      await seedWebhook(busy, 1)
    }
    await seedWebhook(quiet, 1)

    // Claim directly: the per-organisation cap is invisible through the
    // HTTP summary, which reports a whole tick rather than one batch.
    const claimed = await admin<{ organisationId: string }[]>`
      select organisation_id::text as "organisationId"
      from claim_due_jobs(10, 60, 2)
    `
    const byOrganisation = new Map<string, number>()
    for (const row of claimed) {
      byOrganisation.set(
        row.organisationId,
        (byOrganisation.get(row.organisationId) ?? 0) + 1
      )
    }
    expect(byOrganisation.get(busy.owner.organisationId)).toBe(2)
    // The quiet tenant is served in the same batch rather than queuing
    // behind the busy tenant's backlog.
    expect(byOrganisation.get(quiet.owner.organisationId)).toBe(1)

    // This test claims rows without settling them, so drop its fixtures
    // rather than leaving due (or leased) work for the next tick.
    await admin`
      delete from processed_webhook_event
      where organisation_id in (
        ${busy.owner.organisationId}, ${quiet.owner.organisationId}
      )
    `
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
          response.json() as Promise<{
            skipped?: true
            webhooks?: number
          }>
      )
    )
    expect(summaries.filter((item) => item.skipped)).toHaveLength(1)
    expect(summaries.reduce((sum, item) => sum + (item.webhooks ?? 0), 0)).toBe(
      1
    )
  })

  describe("with publishing paused", () => {
    let paused: Awaited<ReturnType<typeof startAppServer>>

    beforeAll(async () => {
      paused = await startAppServer({
        GOOGLE_API_PROXY_BASE: stub.baseUrl,
        GOOGLE_TIMEOUT_MS: "2500",
        GOOGLE_MUTATION_TIMEOUT_MS: "2500",
        PUBLISH_ENABLED: "false",
      })
    }, 60_000)

    afterAll(async () => {
      await paused.stop()
    })

    it("claims no publish work and still drains the sync work", async () => {
      const subject = await fixture()
      healthyReviews()
      const attemptId = await seedPublishAttempt(
        subject,
        "ambiguous",
        "A reply the kill switch must not send."
      )
      const eventId = await seedWebhook(subject, 0)
      const before = await attemptState(attemptId)

      await runTick(paused.baseUrl)

      // Untouched, not skipped: the row keeps the status and the due time it
      // had, so the backlog drains by itself when the flag comes back.
      const after = await attemptState(attemptId)
      expect(after).toMatchObject({ status: "ambiguous", recoveryAttempts: 0 })
      expect(after.nextAttemptAt).toEqual(before.nextAttemptAt)
      expect(after.leaseExpiresAt).toBeNull()
      // PUBLISH_ENABLED is the narrow switch: ingestion keeps running.
      expect((await webhookState(eventId)).status).toBe("processed")
    }, 30_000)
  })
})
