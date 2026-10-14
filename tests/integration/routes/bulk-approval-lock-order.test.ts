import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { bulkReviewResultSchema } from "@/lib/contracts/reviews"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  saveHumanDraft,
  seedGoogleConnection,
  seedLinkedReview,
  seedMemberUser,
} from "../helpers/tenant"

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
const BODY = "Thank you for sharing your experience."
const ROUNDS = 5
const REVIEWS_PER_ROUND = 4

/**
 * Every approval decision locks its review first (lockReview), and a bulk
 * approval on the engine records all of its decisions in one transaction. Two
 * overlapping batches that took those locks in the order they were listed
 * (one oldest first, the other newest first) met in the middle and one row
 * died with 40P01, reported as `failed` / `bulk_row_failed`. The batch now
 * locks its reviews in id order before the first decision (lockReviews).
 *
 * Batch starts are also serialised per organisation, and a review already
 * queued in a live batch is skipped as `template_review_busy` rather than
 * decided twice (#91). So of two overlapping batches, the later start either
 * skips every review the earlier one queued, or — when the runner already
 * finished them — decides them again. Neither may lose a row to a deadlock.
 */
describeDatabase("bulk approval lock order", { timeout: 120_000 }, () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  const probe = `bulk_lock_probe_${randomUUID().replaceAll("-", "")}`

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    stub = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      PUBLISH_ENABLED: "true",
      JOBS_ENABLED: "true",
    })
  })
  afterAll(async () => {
    await admin.unsafe(`
        drop trigger if exists ${probe} on approval_decision;
        drop function if exists ${probe}();
      `)
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it(`never deadlocks across ${ROUNDS} overlapping batches listed in opposite orders`, async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    await admin`
        insert into organisation_feature (organisation_id, feature, enabled, changed_by)
        values (${owner.organisationId}, 'bulk_actions', true, 'test')`
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const requester = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      role: "member",
      canPublish: false,
    })
    // Test-only: hold each decision inside its insert, with its review
    // locked, so the two batches are certain to overlap. Only this
    // organisation's decisions sleep.
    await admin.unsafe(`
        create function ${probe}() returns trigger language plpgsql as $$
        begin
          perform pg_sleep(0.05);
          return new;
        end;
        $$;
        create trigger ${probe}
          after insert on approval_decision
          for each row
          when (new.organisation_id = '${owner.organisationId}')
          execute function ${probe}();
      `)

    /** A reply a member parked for approval, as the owner's inbox shows it. */
    const parked = async () => {
      const seeded = await seedLinkedReview(admin, {
        organisationId: owner.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
      })
      const draft = await saveHumanDraft(
        server.baseUrl,
        requester.cookie,
        seeded.reviewId,
        BODY
      )
      const requested = await fetch(
        `${server.baseUrl}/api/reviews/${seeded.reviewId}/publish`,
        {
          method: "POST",
          headers: {
            cookie: requester.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            draftId: draft.draftId,
            expectedReviewUpdateTime: draft.expectedReviewUpdateTime,
          }),
        }
      )
      expect(requested.status, await requested.clone().text()).toBe(202)
      return {
        reviewId: seeded.reviewId,
        draftId: draft.draftId,
        reviewUpdateTime: draft.expectedReviewUpdateTime,
      }
    }
    const approve = async (approvals: unknown[]) => {
      const response = await fetch(`${server.baseUrl}/api/reviews/bulk`, {
        method: "POST",
        headers: {
          cookie: owner.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "approve", approvals }),
      })
      expect(response.status, await response.clone().text()).toBe(200)
      return bulkReviewResultSchema.parse(await response.json())
    }

    const failures: string[] = []
    for (let round = 0; round < ROUNDS; round += 1) {
      const shown = []
      for (let index = 0; index < REVIEWS_PER_ROUND; index += 1)
        shown.push(await parked())
      const [forward, reverse] = await Promise.all([
        approve(shown),
        approve([...shown].reverse()),
      ])
      // Each review is decided once per batch that queued it, and every row
      // is either queued or skipped as busy: none fails.
      const queued = new Map<string, number>()
      for (const result of [forward, reverse]) {
        for (const row of result.results) {
          if (row.status === "queued") {
            expect(result.operationId).toBeDefined()
            queued.set(row.reviewId, (queued.get(row.reviewId) ?? 0) + 1)
          } else if (
            row.status !== "skipped" ||
            row.code !== "template_review_busy"
          ) {
            failures.push(
              `${round}: ${row.reviewId} ${row.status} ${row.code ?? ""}`
            )
          }
        }
      }
      const decisions = await admin<{ reviewId: string; count: number }[]>`
          select review_id::text as "reviewId", count(*)::int as count
          from approval_decision
          where review_id in ${admin(shown.map((item) => item.reviewId))}
          group by review_id`
      for (const item of shown) {
        const expected = queued.get(item.reviewId) ?? 0
        const recorded =
          decisions.find((row) => row.reviewId === item.reviewId)?.count ?? 0
        if (expected === 0 || recorded !== expected)
          failures.push(
            `${round}: ${item.reviewId} ${recorded} decisions, ${expected} queued`
          )
      }
    }
    expect(failures).toEqual([])
  })
})
