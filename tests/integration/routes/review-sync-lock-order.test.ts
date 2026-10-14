import { randomUUID } from "node:crypto"

import postgres, { type TransactionSql } from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { lockReview } from "@/lib/server/publishing/settle"
import {
  syncLinkedLocation,
  upsertGoogleReview,
  type LinkedLocation,
} from "@/lib/server/reviews"

import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

// The page Google serves; the token and the fetch are the only provider calls
// a reconcile makes, and everything after them is the real page transaction.
const google = vi.hoisted(() => ({
  page: [] as Record<string, unknown>[],
}))
vi.mock("@/lib/server/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/google")>()),
  connectionAccessToken: async () => "stub-access-token",
  googleReviews: async () => ({ reviews: google.page }),
}))

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

type Payload = Record<string, unknown>

const ITERATIONS = 5

function sqlState(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : null
}

/**
 * A sync page upserts every review Google changed in one transaction, and
 * each upsert locks its review. In Google's order, a page holding a newer
 * review while it waited for an older one deadlocked (40P01) against a
 * transaction locking the same reviews in id order, as a bulk approval does
 * (lockReviews). The page now locks the reviews it will write in id order
 * before the first upsert.
 */
describeDatabase(
  "review lock order: sync page against bulk",
  { timeout: 60_000 },
  () => {
    let admin: ReturnType<typeof postgres>
    let runtime: ReturnType<typeof postgres>
    const organisations: string[] = []
    let linked: LinkedLocation
    let organisationId: string

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
    })

    afterAll(async () => {
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

    const EDITED = "Lovely Sunday lunch, but the service was slow."

    /** Two stored reviews, and the page in which Google edited both. */
    async function editedPair() {
      const stored = await Promise.all(
        [providerReview(), providerReview()].map(async (payload) => ({
          payload,
          id: (await inTenant((sql) =>
            upsertGoogleReview(sql, organisationId, linked, payload)
          ))!,
        }))
      )
      const [low, high] = stored.sort((a, b) => a.id.localeCompare(b.id))
      const edit = (payload: Payload) => ({
        ...payload,
        comment: EDITED,
        updateTime: "2026-09-05T10:00:00.000Z",
      })
      // The higher id first: the order that crossed an ascending locker.
      return { low, high, page: [edit(high.payload), edit(low.payload)] }
    }

    it(`never deadlocks across ${ITERATIONS} pages listed against id order`, async () => {
      const failures: string[] = []
      for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
        const { low, high, page } = await editedPair()
        google.page = page

        // Locks the two reviews the way a bulk approval does: ascending, one
        // decision at a time, holding each until it commits.
        let held!: () => void
        const holding = new Promise<void>((resolve) => (held = resolve))
        const bulk = inTenant(async (sql) => {
          await lockReview(sql, low.id)
          held()
          await sql`select pg_sleep(0.5)`
          await lockReview(sql, high.id)
        })
        const sync = holding.then(() =>
          syncLinkedLocation({
            organisationId,
            externalLocationId: linked.externalLocationId,
            type: "reconcile",
            maxPages: 1,
          })
        )
        const [bulkResult, syncResult] = await Promise.allSettled([bulk, sync])

        if (bulkResult.status === "rejected")
          failures.push(
            `${iteration} bulk: ${sqlState(bulkResult.reason) ?? bulkResult.reason}`
          )
        if (syncResult.status === "rejected")
          failures.push(`${iteration} sync: ${syncResult.reason}`)
        else if (syncResult.value.status !== "succeeded")
          failures.push(
            `${iteration} sync: ${syncResult.value.status} ${syncResult.value.errorCode ?? ""}`
          )
        else {
          const texts = await admin<{ text: string | null }[]>`
          select review_text as text from review
          where id in ${admin([low.id, high.id])}`
          expect(texts.map((row) => row.text)).toEqual([EDITED, EDITED])
        }
      }
      expect(failures).toEqual([])
    })
  }
)
