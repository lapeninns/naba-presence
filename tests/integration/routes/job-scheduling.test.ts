import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { scheduleResponseSchema } from "@/lib/contracts/publication-schedules"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
  seedLinkedReview,
} from "../helpers/tenant"

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
const CRON = { authorization: "Bearer route-harness-cron-secret" }

/** Organisations carrying the backlog, and linked locations in each. */
const BACKLOG_ORGANISATIONS = 10
const LOCATIONS_PER_ORGANISATION = 100

/**
 * WP-12 acceptance (audit 2026-10-14, W8-02/W8-03): with about 1,000
 * recurring syncs queued and due, one tick still publishes a scheduled post
 * that is due inside its 5-minute window, and still starts a reply retry
 * that fell due after the whole herd.
 *
 * The backlog cannot drain inside one tick: the production default Google
 * pacing (240 calls a minute, process-local) alone holds a 45-second tick to
 * about 180 provider calls, and each review list answers in 500 ms. Before
 * WP-12 the queue ran first until under 15 seconds were left, so scheduled
 * posts were never reached, and the retry sat behind its organisation's
 * hundred older reconcile rows, three per batch.
 */
describeDatabase(
  "job scheduling under a sync backlog",
  { timeout: 180_000 },
  () => {
    let admin: ReturnType<typeof postgres>
    let stub: GoogleStub
    let server: Awaited<ReturnType<typeof startAppServer>>
    const organisations: string[] = []
    const posts: Array<Record<string, unknown>> = []

    beforeAll(async () => {
      admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
      stub = await startGoogleStub()
      server = await startAppServer({
        GOOGLE_API_PROXY_BASE: stub.baseUrl,
        GOOGLE_TIMEOUT_MS: "5000",
        GOOGLE_API_REQUESTS_PER_MINUTE: "240",
        GBP_POSTS_ENABLED: "true",
        PUBLISH_ENABLED: "true",
        JOBS_ENABLED: "true",
      })
      stub.respond({ method: "GET", pathIncludes: "/reviews" }, () => ({
        status: 200,
        json: { reviews: [], totalReviewCount: 0 },
        delayMs: 500,
      }))
      stub.respond({ method: "POST", pathIncludes: "/localPosts" }, (call) => {
        const path = new URL(call.path, "https://stub.test").pathname.replace(
          /^\/v4\//,
          ""
        )
        const post = {
          ...(call.body as object),
          name: `${path}/p${posts.length + 1}`,
          state: "LIVE",
        }
        posts.push(post)
        return { status: 200, json: post }
      })
      stub.respond({ method: "GET", pathIncludes: "/localPosts?" }, () => ({
        status: 200,
        json: { localPosts: posts },
      }))
      stub.respond({ method: "GET", pathIncludes: "/localPosts/" }, (call) => {
        const found = posts.find((post) =>
          call.path.includes(String(post.name))
        )
        return found
          ? { status: 200, json: found }
          : { status: 404, json: { error: { status: "NOT_FOUND" } } }
      })
      stub.respond({ method: "PUT", pathIncludes: "/reply" }, (call) => ({
        status: 200,
        json: {
          comment: (call.body as { comment?: string }).comment,
          updateTime: new Date().toISOString(),
        },
      }))
    }, 120_000)

    afterAll(async () => {
      await server?.stop()
      await stub?.stop()
      await destroyTenants(admin, organisations)
      await admin.end()
    }, 120_000)

    /** One organisation with `count` linked locations, each with a due reconcile. */
    async function backlogOrganisation(count: number) {
      const owner = await createTestTenant(admin)
      organisations.push(owner.organisationId)
      const connection = await seedGoogleConnection(admin, {
        organisationId: owner.organisationId,
      })
      const externalIds = Array.from({ length: count }, () => randomUUID())
      const locationIds = Array.from({ length: count }, () => randomUUID())
      await admin`
      insert into external_location (
        id, organisation_id, google_connection_id, google_account_name,
        google_location_name, title, verified
      )
      select id, ${owner.organisationId}, ${connection.connectionId},
        ${connection.googleAccountName}, 'locations/backlog-' || id::text,
        'Backlog location', true
      from unnest(${externalIds}::uuid[]) as id
    `
      await admin`
      insert into location (id, organisation_id, name)
      select id, ${owner.organisationId}, 'Backlog ' || id::text
      from unnest(${locationIds}::uuid[]) as id
    `
      await admin`
      insert into location_link (
        organisation_id, external_location_id, location_id, is_active
      )
      select ${owner.organisationId}, e, l, true
      from unnest(${externalIds}::uuid[], ${locationIds}::uuid[]) as t(e, l)
    `
      // Armed the way ensure_recurring_checkpoints arms a herd: all at once,
      // a minute before anything else here fell due.
      await admin`
      insert into sync_checkpoint (
        organisation_id, external_location_id, sync_type, status,
        next_attempt_at
      )
      select ${owner.organisationId}, e, 'reconcile', 'pending',
        now() - interval '1 minute'
      from unnest(${externalIds}::uuid[]) as e
    `
      return { owner, connection }
    }

    /** A reply publish waiting on its back-off, due now, in `organisationId`. */
    async function dueRetry(input: {
      organisationId: string
      userId: string
      connectionId: string
      googleAccountName: string
    }) {
      const linked = await seedLinkedReview(admin, {
        organisationId: input.organisationId,
        connectionId: input.connectionId,
        googleAccountName: input.googleAccountName,
      })
      // The workflow trigger (0006) only reaches publish_requested this way.
      for (const status of ["drafted", "verified", "publish_requested"]) {
        await admin`
        update review set workflow_status = ${status} where id = ${linked.reviewId}
      `
      }
      const body = "Thank you, we hope to see you again soon."
      const [reply] = await admin<{ id: string }[]>`
      insert into review_reply (
        organisation_id, review_id, current_body, publish_status
      )
      values (${input.organisationId}, ${linked.reviewId}, ${body}, 'accepted')
      returning id::text as id
    `
      const [attempt] = await admin<{ id: string }[]>`
      insert into publish_attempt (
        organisation_id, review_reply_id, idempotency_key, request_body_hash,
        status, attempt_no, operation, intended_body, started_at,
        next_attempt_at, authorised_by, authorised_aal,
        authorised_security_version, authorised_connection_id,
        authorised_approval_required, authorised_two_person_approval
      )
      values (
        ${input.organisationId}, ${reply.id}, ${randomUUID()}, ${randomUUID()},
        'retryable', 1, 'publish', ${body}, now(), now(),
        ${input.userId}, 'aal1', 1, ${input.connectionId},
        (select approval_required from organisation where id = ${input.organisationId}),
        (select require_two_person_approval from organisation where id = ${input.organisationId})
      )
      returning id::text as id
    `
      return attempt.id
    }

    /** An approved one-time scheduled post whose slot was two minutes ago. */
    async function duePost() {
      const owner = await createTestTenant(admin)
      organisations.push(owner.organisationId)
      await admin`
      insert into organisation_feature (organisation_id, feature, enabled, changed_by)
      values (${owner.organisationId}, 'post_scheduling', true, 'job-scheduling test')
    `
      const connection = await seedGoogleConnection(admin, {
        organisationId: owner.organisationId,
      })
      const linked = await seedLinkedLocation(admin, {
        organisationId: owner.organisationId,
        ...connection,
      })
      const api = (path: string, body: unknown) =>
        fetch(`${server.baseUrl}/api/locations/${linked.locationId}${path}`, {
          method: "POST",
          headers: { cookie: owner.cookie, "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      const drafted = await api("/posts", {
        topicType: "STANDARD",
        languageCode: "en-GB",
        summary: "Quiz night is back on Thursday",
        media: [],
      })
      expect(drafted.status, await drafted.clone().text()).toBe(201)
      const postId = (await drafted.json()).post.id as string
      const scheduled = await api("/post-schedules", {
        postId,
        rule: {
          frequency: "once",
          startDate: new Date(Date.now() + 86_400_000)
            .toISOString()
            .slice(0, 10),
          localTime: "09:00",
        },
        timezone: "Europe/London",
      })
      expect(scheduled.status, await scheduled.clone().text()).toBe(200)
      const schedule = scheduleResponseSchema.parse(
        await scheduled.json()
      ).schedule
      const approved = await api(`/post-schedules/${schedule.id}/approve`, {
        expectedPayloadHash: schedule.payloadHash,
        revision: schedule.revision,
      })
      expect(approved.status, await approved.clone().text()).toBe(200)
      // Time passing: the slot fell due two minutes ago, so three minutes of
      // its 5-minute window are left (0117 moves the deadline with it).
      await admin`
      update post_publication_occurrence
      set intended_at = now() - interval '2 minutes'
      where schedule_id = ${schedule.id}
    `
      return schedule.id
    }

    it("publishes a due scheduled post and starts a later reply retry in one tick behind 1,000 queued syncs", async () => {
      const backlog = []
      for (let index = 0; index < BACKLOG_ORGANISATIONS; index += 1) {
        backlog.push(await backlogOrganisation(LOCATIONS_PER_ORGANISATION))
      }
      const busiest = backlog[0]
      const attemptId = await dueRetry({
        organisationId: busiest.owner.organisationId,
        userId: busiest.owner.userId,
        connectionId: busiest.connection.connectionId,
        googleAccountName: busiest.connection.googleAccountName,
      })
      const scheduleId = await duePost()

      const due = await admin<{ count: number }[]>`
      select count(*)::int as count from sync_checkpoint
      where organisation_id = any(${organisations}::uuid[])
        and sync_type = 'reconcile' and next_attempt_at <= now()
    `
      expect(due[0].count).toBe(
        BACKLOG_ORGANISATIONS * LOCATIONS_PER_ORGANISATION
      )

      const response = await fetch(`${server.baseUrl}/api/jobs/run`, {
        method: "POST",
        headers: CRON,
      })
      expect(response.status, await response.clone().text()).toBe(200)
      const summary = (await response.json()) as {
        recurring: number
        attempts: number
        schedules?: { published: number }
      }

      // The scheduled post went out inside its window...
      expect(summary.schedules).toMatchObject({ published: 1 })
      const occurrences = await admin<{ status: string; inWindow: boolean }[]>`
      select status, now() < deadline_at as "inWindow"
      from post_publication_occurrence where schedule_id = ${scheduleId}
    `
      expect(occurrences).toEqual([{ status: "published", inWindow: true }])
      expect(posts).toHaveLength(1)

      // ...the retry, due after every herd row, ran in this same tick...
      expect(summary.attempts).toBe(1)
      const [attempt] = await admin<{ status: string }[]>`
      select status from publish_attempt where id = ${attemptId}
    `
      expect(attempt.status).toBe("succeeded")

      // ...and the backlog was real: the tick ended with most of it still due.
      const left = await admin<{ count: number }[]>`
      select count(*)::int as count from sync_checkpoint
      where organisation_id = any(${organisations}::uuid[])
        and sync_type = 'reconcile' and next_attempt_at <= now()
    `
      expect(summary.recurring).toBeGreaterThan(0)
      expect(left[0].count).toBeGreaterThan(500)
    })
  }
)
