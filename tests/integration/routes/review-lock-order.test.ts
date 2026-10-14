import { createHash, randomUUID } from "node:crypto"

import postgres, { type TransactionSql } from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { GoogleReviewResource } from "@/lib/server/publishing/provider"
import { recoverAttempt } from "@/lib/server/publishing/recover"
import { setReviewWorkflow } from "@/lib/server/publishing/settle"
import { upsertGoogleReview, type LinkedLocation } from "@/lib/server/reviews"

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

type Payload = Record<string, unknown>

const ITERATIONS = 50

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function sqlState(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : null
}

/**
 * Review sync and the publishing settle paths lock the same review,
 * review_reply and publish_attempt rows. Sync takes the review and then the
 * reply; a settle that took the reply first and the review last deadlocked
 * against it (40P01). Every publishing transaction now takes the review row
 * first (lockReview, lib/server/publishing/settle.ts).
 */
describeDatabase(
  "review lock order: sync ingest against publish settle",
  () => {
    let admin: ReturnType<typeof postgres>
    let runtime: ReturnType<typeof postgres>
    const organisations: string[] = []
    let linked: LinkedLocation
    let organisationId: string
    const probe = `lock_order_probe_${randomUUID().replaceAll("-", "")}`

    beforeAll(async () => {
      admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 4 })
      runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, { max: 4 })

      const owner = await createTestTenant(admin)
      organisationId = owner.organisationId
      organisations.push(organisationId)
      const connection = await seedGoogleConnection(admin, { organisationId })
      const seed = await seedLinkedReview(admin, {
        organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
      })
      const [external] = await admin<{ googleLocationName: string }[]>`
      select google_location_name as "googleLocationName"
      from external_location
      where id = ${seed.externalLocationId}
    `
      linked = {
        externalLocationId: seed.externalLocationId,
        locationId: seed.locationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
        googleLocationName: external.googleLocationName,
        verified: true,
      }

      // Test-only: hold the settle inside its reply write for long enough that
      // the sync is certain to reach the review in between. Only replies whose
      // body names this probe sleep.
      await admin.unsafe(`
      create function ${probe}() returns trigger language plpgsql as $$
      begin
        perform pg_sleep(0.3);
        return new;
      end;
      $$;
      create trigger ${probe}
        after update of publish_status on review_reply
        for each row
        when (
          new.publish_status = 'published'
          and new.current_body like '${probe}%'
        )
        execute function ${probe}();
    `)
    })

    afterAll(async () => {
      await admin.unsafe(`
      drop trigger if exists ${probe} on review_reply;
      drop function if exists ${probe}();
    `)
      await destroyTenants(admin, organisations)
      await runtime.end()
      await admin.end()
    })

    function inTenant<T>(
      work: (sql: TransactionSql) => Promise<T>
    ): Promise<T> {
      return runtime.begin(async (sql) => {
        await sql`
        select set_config('app.organisation_id', ${organisationId}, true)
      `
        return work(sql)
      }) as Promise<T>
    }

    async function databaseNow() {
      const [{ now }] = await admin<{ now: Date }[]>`select now() as now`
      return now
    }

    function providerReview(): Payload {
      const name = `${linked.googleAccountName}/${linked.googleLocationName}/reviews/${randomUUID()}`
      return {
        name,
        reviewId: name.split("/").at(-1),
        reviewer: { displayName: "Provider reviewer" },
        starRating: "FIVE",
        comment: "Lovely Sunday lunch.",
        createTime: "2026-09-01T10:00:00.000Z",
        updateTime: "2026-09-01T10:00:00.000Z",
      }
    }

    function syncPage(review: Payload, fetchedAfter: Date) {
      return inTenant((sql) =>
        upsertGoogleReview(sql, organisationId, linked, review, {
          fetchedAfter,
        })
      )
    }

    /**
     * A stored review with a publish whose PUT went unconfirmed: the reply
     * `accepted`, the attempt `ambiguous`, the review `publish_requested`.
     */
    async function ambiguousPublish(body: string) {
      const original = providerReview()
      const reviewId = (await syncPage(original, await databaseNow()))!
      const attemptId = await inTenant(async (sql) => {
        await setReviewWorkflow(sql, reviewId, "drafted")
        await setReviewWorkflow(sql, reviewId, "verified")
        const [reply] = await sql<{ id: string }[]>`
        insert into review_reply (
          organisation_id, review_id, current_body, publish_status
        )
        values (${organisationId}, ${reviewId}, ${body}, 'accepted')
        returning id::text as id
      `
        const [attempt] = await sql<{ id: string }[]>`
        insert into publish_attempt (
          organisation_id, review_reply_id, idempotency_key,
          request_body_hash, intended_body, status, attempt_no, operation,
          publish_generation
        )
        values (
          ${organisationId}, ${reply.id}, ${randomUUID()},
          ${sha256(body)}, ${body}, 'ambiguous', 1, 'publish', 0
        )
        returning id::text as id
      `
        await setReviewWorkflow(sql, reviewId, "publish_requested")
        return attempt.id
      })
      // What the next sync reads: the reviewer edited the review (so the sync
      // writes it) and Google holds the reply the PUT sent.
      const fresh = {
        ...original,
        comment: "Lovely Sunday lunch, but the service was slow.",
        updateTime: "2026-09-05T10:00:00.000Z",
        reviewReply: { comment: body, updateTime: "2026-09-05T11:00:00.000Z" },
      }
      return { reviewId, attemptId, fresh }
    }

    async function stored(reviewId: string, attemptId: string) {
      const [row] = await admin<
        {
          body: string | null
          replyStatus: string
          workflow: string
          text: string | null
          attemptStatus: string
        }[]
      >`
      select
        rr.current_body as body,
        rr.publish_status as "replyStatus",
        r.workflow_status as workflow,
        r.review_text as text,
        pa.status as "attemptStatus"
      from review r
      join review_reply rr on rr.review_id = r.id
      join publish_attempt pa on pa.review_reply_id = rr.id
      where r.id = ${reviewId}
        and pa.id = ${attemptId}
    `
      return row
    }

    function expectSettled(
      row: Awaited<ReturnType<typeof stored>>,
      body: string
    ) {
      expect(row).toEqual({
        body,
        replyStatus: "published",
        workflow: "published",
        // The reviewer's edit lands whichever transaction commits first.
        text: "Lovely Sunday lunch, but the service was slow.",
        attemptStatus: "succeeded",
      })
    }

    /** Resolves once a backend is asleep inside the probe trigger. */
    async function settleHoldsReply() {
      for (let poll = 0; poll < 200; poll += 1) {
        const [asleep] = await admin`
        select 1
        from pg_stat_activity
        where datname = current_database()
          and wait_event = 'PgSleep'
          and query ilike '%update review_reply%'
      `
        if (asleep) return
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error("The settle never reached its reply write.")
    }

    it("serialises a sync that arrives while the settle holds the reply", async () => {
      const body = `${probe} Thank you, we hope to see you again soon.`
      const { reviewId, attemptId, fresh } = await ambiguousPublish(body)
      readback.review = { reviewReply: { comment: body } }
      const fetchedAfter = await databaseNow()

      const settle = recoverAttempt({ organisationId, attemptId })
      // Before the fix the settle held the reply here without the review, the
      // sync then took the review and queued for the reply, and the settle's
      // workflow update closed the cycle.
      const sync = settleHoldsReply().then(() => syncPage(fresh, fetchedAfter))
      const results = await Promise.allSettled([settle, sync])

      // A rejection reports its SQLSTATE: 40P01 was the deadlock.
      expect(
        results.map((result) =>
          result.status === "rejected"
            ? (sqlState(result.reason) ?? result.reason)
            : result.status
        )
      ).toEqual(["fulfilled", "fulfilled"])
      expect(results[0]).toMatchObject({ value: "succeeded" })
      expectSettled(await stored(reviewId, attemptId), body)
    })

    it(`never deadlocks across ${ITERATIONS} parallel sync and settle races`, async () => {
      const deadlocks: string[] = []
      for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
        const body = `Thank you for visiting (${iteration}).`
        const { reviewId, attemptId, fresh } = await ambiguousPublish(body)
        readback.review = { reviewReply: { comment: body } }
        const fetchedAfter = await databaseNow()

        // Either side may start first; alternate which is issued first.
        const racers =
          iteration % 2 === 0
            ? [
                recoverAttempt({ organisationId, attemptId }),
                syncPage(fresh, fetchedAfter),
              ]
            : [
                syncPage(fresh, fetchedAfter),
                recoverAttempt({ organisationId, attemptId }),
              ]
        const results = await Promise.allSettled(racers)
        const failures = results.flatMap((result) =>
          result.status === "rejected"
            ? [`${iteration}: ${sqlState(result.reason) ?? result.reason}`]
            : []
        )
        deadlocks.push(...failures)
        if (failures.length === 0) {
          expectSettled(await stored(reviewId, attemptId), body)
        }
      }
      expect(deadlocks).toEqual([])
    })
  }
)
