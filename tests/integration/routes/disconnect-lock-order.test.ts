import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { GoogleReviewResource } from "@/lib/server/publishing/provider"
import { recoverAttempt } from "@/lib/server/publishing/recover"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

// The readback is the only provider call recovery makes; everything after it
// is the real settle transaction.
const readback = vi.hoisted(() => ({
  review: null as GoogleReviewResource | null,
}))
vi.mock("@/lib/server/publishing/provider", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/server/publishing/provider")
  >()),
  readGoogleReview: async () => readback.review,
}))

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

function sqlState(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : null
}

/**
 * The disconnect route settles the attempts it strands: the attempt, then
 * the reply, then the review. A recovery settle takes the review first
 * (lockReview, lib/server/publishing/settle.ts), so a disconnect that took
 * the attempt first and the review last deadlocked against it (40P01). The
 * route now locks the review rows before it touches an attempt.
 */
describeDatabase(
  "review lock order: disconnect against recovery settle",
  () => {
    let admin: ReturnType<typeof postgres>
    let server: Awaited<ReturnType<typeof startAppServer>>
    let google: GoogleStub
    let owner: Awaited<ReturnType<typeof createTestTenant>>
    let connectionId: string
    let reviewId: string
    let attemptId: string
    const body = "Thank you, we hope to see you again soon."
    const probe = `lock_order_probe_${randomUUID().replaceAll("-", "")}`

    beforeAll(async () => {
      admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 4 })
      owner = await createTestTenant(admin)
      const connection = await seedGoogleConnection(admin, {
        organisationId: owner.organisationId,
      })
      connectionId = connection.connectionId
      const seeded = await seedLinkedReview(admin, {
        organisationId: owner.organisationId,
        connectionId,
        googleAccountName: connection.googleAccountName,
      })
      reviewId = seeded.reviewId

      // A publish whose PUT went unconfirmed: the reply `accepted`, the
      // attempt `ambiguous`, the review `publish_requested`.
      const replyId = randomUUID()
      attemptId = randomUUID()
      await admin`
      insert into review_reply (
        id, organisation_id, review_id, current_body, publish_status
      )
      values (${replyId}, ${owner.organisationId}, ${reviewId}, ${body}, 'accepted')
    `
      for (const status of ["drafted", "verified", "publish_requested"]) {
        await admin`
        update review set workflow_status = ${status} where id = ${reviewId}
      `
      }
      await admin`
      insert into publish_attempt (
        id, organisation_id, review_reply_id, idempotency_key,
        request_body_hash, intended_body, status, attempt_no
      )
      values (
        ${attemptId}, ${owner.organisationId}, ${replyId},
        ${`lock-order-key-${attemptId}`}, ${`lock-order-hash-${attemptId}`},
        ${body}, 'ambiguous', 1
      )
    `

      // Test-only: hold the disconnect just after it settles this attempt, so
      // the recovery settle is certain to arrive while it is still open.
      await admin.unsafe(`
      create function ${probe}() returns trigger language plpgsql as $$
      begin
        perform pg_sleep(0.5);
        return new;
      end;
      $$;
      create trigger ${probe}
        after update of status on publish_attempt
        for each row
        when (
          new.id = '${attemptId}'
          and new.provider_error_code = 'connection_disconnected'
        )
        execute function ${probe}();
    `)

      google = await startGoogleStub()
      google.respond({ method: "POST", pathEndsWith: "/revoke" }, () => ({
        status: 200,
        json: {},
      }))
      server = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl })
    })

    afterAll(async () => {
      await server.stop()
      await google.stop()
      await admin.unsafe(`
      drop trigger if exists ${probe} on publish_attempt;
      drop function if exists ${probe}();
    `)
      await destroyTenants(admin, [owner.organisationId])
      await admin.end()
    })

    /** Resolves once a backend is asleep inside the probe trigger. */
    async function disconnectHoldsAttempt() {
      for (let poll = 0; poll < 500; poll += 1) {
        const [asleep] = await admin`
        select 1
        from pg_stat_activity
        where datname = current_database()
          and wait_event = 'PgSleep'
          and query ilike '%update publish_attempt%'
      `
        if (asleep) return
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error("The disconnect never reached its attempt write.")
    }

    it("serialises a recovery settle that arrives while the disconnect holds the attempt", async () => {
      readback.review = { reviewReply: { comment: body } }

      const disconnect = fetch(
        `${server.baseUrl}/api/google/connections/${connectionId}/disconnect`,
        { method: "POST", headers: { cookie: owner.cookie } }
      ).then(async (response) => ({
        status: response.status,
        body: await response.text(),
      }))
      // Before the fix the disconnect held the attempt here without the
      // review, the settle then took the review and queued for the attempt,
      // and the disconnect's workflow update closed the cycle.
      const settle = disconnectHoldsAttempt().then(() =>
        recoverAttempt({ organisationId: owner.organisationId, attemptId })
      )
      const [disconnected, settled] = await Promise.allSettled([
        disconnect,
        settle,
      ])

      // A rejection reports its SQLSTATE: 40P01 was the deadlock.
      expect(
        settled.status === "rejected"
          ? (sqlState(settled.reason) ?? settled.reason)
          : settled.status
      ).toBe("fulfilled")
      expect(disconnected).toMatchObject({
        status: "fulfilled",
        value: { status: 200 },
      })

      // The disconnect committed first, so the settle found nothing to settle.
      const [row] = await admin<
        {
          attempt: string
          code: string | null
          reply: string
          workflow: string
        }[]
      >`
      select
        pa.status as attempt,
        pa.provider_error_code as code,
        rr.publish_status as reply,
        r.workflow_status as workflow
      from publish_attempt pa
      join review_reply rr on rr.id = pa.review_reply_id
      join review r on r.id = rr.review_id
      where pa.id = ${attemptId}
    `
      expect(row).toEqual({
        attempt: "failed",
        code: "connection_disconnected",
        reply: "failed",
        workflow: "failed",
      })
    })
  }
)
