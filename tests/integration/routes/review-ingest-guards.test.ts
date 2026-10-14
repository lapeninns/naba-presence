import { createHash, randomUUID } from "node:crypto"

import postgres, { type TransactionSql } from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  applyPublishedReply,
  setReviewWorkflow,
} from "@/lib/server/publishing/settle"
import { upsertGoogleReview, type LinkedLocation } from "@/lib/server/reviews"

import { startAppServer } from "../helpers/app-server"
import {
  startGoogleStub,
  type GoogleStub,
  type GoogleStubResponse,
} from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

type Payload = Record<string, unknown>

type Fixture = {
  organisationId: string
  cookie: string
  linked: LinkedLocation
}

type TableWrites = Record<
  "review" | "review_reply" | "review_media_item",
  { inserted: number; updated: number; deleted: number }
>

type Intent = { replyId: string; attemptId: string }

const NEW_REPLY = "Thank you, we hope to see you again soon."

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function providerReview(name: string, overrides: Payload = {}): Payload {
  return {
    name,
    reviewId: name.split("/").at(-1),
    reviewer: { displayName: "Provider reviewer" },
    starRating: "FIVE",
    comment: "Lovely Sunday lunch.",
    createTime: "2026-09-01T10:00:00.000Z",
    updateTime: "2026-09-01T10:00:00.000Z",
    ...overrides,
  }
}

function withReply(review: Payload, comment: string, updateTime: string) {
  return { ...review, reviewReply: { comment, updateTime } }
}

function edited(review: Payload): Payload {
  return {
    ...review,
    comment: "Lovely Sunday lunch, but the service was slow.",
    updateTime: "2026-09-05T10:00:00.000Z",
  }
}

describeDatabase("guarded review ingest", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  const organisations: string[] = []

  beforeAll(() => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, { max: 1 })
  })

  afterAll(async () => {
    await destroyTenants(admin, organisations)
    await runtime.end()
    await admin.end()
  })

  async function createFixture(): Promise<Fixture> {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const seed = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const [external] = await admin<{ googleLocationName: string }[]>`
      select google_location_name as "googleLocationName"
      from external_location
      where id = ${seed.externalLocationId}
    `
    return {
      organisationId: owner.organisationId,
      cookie: owner.cookie,
      linked: {
        externalLocationId: seed.externalLocationId,
        locationId: seed.locationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
        googleLocationName: external.googleLocationName,
        verified: true,
      },
    }
  }

  function reviewName(fixture: Fixture) {
    return `${fixture.linked.googleAccountName}/${fixture.linked.googleLocationName}/reviews/${randomUUID()}`
  }

  function inTenant<T>(
    organisationId: string,
    work: (sql: TransactionSql) => Promise<T>
  ): Promise<T> {
    return runtime.begin(async (sql) => {
      await sql`
        select set_config('app.organisation_id', ${organisationId}, true)
      `
      return work(sql)
    }) as Promise<T>
  }

  /** A database time read before the page is "fetched", as the sync does. */
  async function databaseNow() {
    const [{ now }] = await admin<{ now: Date }[]>`select now() as now`
    return now
  }

  async function tableWrites(sql: TransactionSql): Promise<TableWrites> {
    const rows = await sql<
      {
        relname: keyof TableWrites
        inserted: number
        updated: number
        deleted: number
      }[]
    >`
      select
        relname,
        n_tup_ins::int as inserted,
        n_tup_upd::int as updated,
        n_tup_del::int as deleted
      from pg_stat_xact_user_tables
      where relname in ('review', 'review_reply', 'review_media_item')
    `
    const writes: TableWrites = {
      review: { inserted: 0, updated: 0, deleted: 0 },
      review_reply: { inserted: 0, updated: 0, deleted: 0 },
      review_media_item: { inserted: 0, updated: 0, deleted: 0 },
    }
    for (const { relname, ...counts } of rows) writes[relname] = counts
    return writes
  }

  /** One sync page transaction, with the writes it made to each table. */
  function syncPage(fixture: Fixture, page: Payload[], fetchedAfter: Date) {
    return inTenant(fixture.organisationId, async (sql) => {
      // Backend-local counters (pending stats can span earlier transactions
      // on this connection), so the page's writes are the difference.
      const before = await tableWrites(sql)
      const ids: string[] = []
      for (const review of page) {
        const id = await upsertGoogleReview(
          sql,
          fixture.organisationId,
          fixture.linked,
          review,
          { fetchedAfter }
        )
        if (id) ids.push(id)
      }
      const after = await tableWrites(sql)
      const writes = {} as TableWrites
      for (const table of Object.keys(after) as Array<keyof TableWrites>) {
        writes[table] = {
          inserted: after[table].inserted - before[table].inserted,
          updated: after[table].updated - before[table].updated,
          deleted: after[table].deleted - before[table].deleted,
        }
      }
      return { ids, writes }
    })
  }

  async function ingest(fixture: Fixture, review: Payload) {
    const { ids } = await syncPage(fixture, [review], await databaseNow())
    return ids[0]
  }

  /** startPublishIntent's committed effects (publishing/intent.ts). */
  function publishIntent(
    fixture: Fixture,
    reviewId: string,
    body: string
  ): Promise<Intent> {
    return inTenant(fixture.organisationId, async (sql) => {
      const [review] = await sql<{ status: string }[]>`
        select workflow_status as status from review where id = ${reviewId}
      `
      if (review.status !== "drafted") {
        await setReviewWorkflow(sql, reviewId, "drafted")
      }
      await setReviewWorkflow(sql, reviewId, "verified")
      const [reply] = await sql<{ id: string }[]>`
        insert into review_reply (
          organisation_id, review_id, current_body, publish_status
        )
        values (${fixture.organisationId}, ${reviewId}, ${body}, 'accepted')
        on conflict (organisation_id, review_id) do update
        set
          current_body = excluded.current_body,
          publish_status = 'accepted'
        returning id::text as id
      `
      const [attempt] = await sql<{ id: string }[]>`
        insert into publish_attempt (
          organisation_id, review_reply_id, idempotency_key,
          request_body_hash, intended_body, status, attempt_no, operation,
          publish_generation
        )
        values (
          ${fixture.organisationId}, ${reply.id}, ${randomUUID()},
          ${sha256(body)}, ${body}, 'started', 1, 'publish', 0
        )
        returning id::text as id
      `
      await setReviewWorkflow(sql, reviewId, "publish_requested")
      return { replyId: reply.id, attemptId: attempt.id }
    })
  }

  /** settlePublishSuccess's local writes (publishing/publish.ts). */
  function settlePublish(
    fixture: Fixture,
    reviewId: string,
    intent: Intent,
    body: string
  ) {
    return inTenant(fixture.organisationId, async (sql) => {
      await applyPublishedReply(sql, intent.replyId, {
        comment: body,
        updateTime: new Date().toISOString(),
      })
      await sql`
        update publish_attempt
        set status = 'succeeded', finished_at = now()
        where id = ${intent.attemptId}
      `
      await setReviewWorkflow(sql, reviewId, "published")
    })
  }

  async function stored(reviewId: string) {
    const [row] = await admin<
      {
        body: string | null
        replyStatus: string | null
        workflow: string
        text: string | null
        contentHash: string
      }[]
    >`
      select
        rr.current_body as body,
        rr.publish_status as "replyStatus",
        r.workflow_status as workflow,
        r.review_text as text,
        r.content_hash as "contentHash"
      from review r
      left join review_reply rr on rr.review_id = r.id
      where r.id = ${reviewId}
    `
    return row
  }

  it("writes nothing when an unchanged page is synced again", async () => {
    const fixture = await createFixture()
    const page = [
      providerReview(reviewName(fixture)),
      providerReview(reviewName(fixture), {
        reviewMediaItems: [{ thumbnailUrl: "https://example.test/photo.jpg" }],
      }),
      withReply(
        providerReview(reviewName(fixture)),
        "Thanks for visiting!",
        "2026-09-02T10:00:00.000Z"
      ),
    ]

    const first = await syncPage(fixture, page, await databaseNow())
    expect(first.writes.review.inserted).toBe(3)
    expect(first.writes.review_reply.inserted).toBe(1)
    expect(first.writes.review_media_item.inserted).toBe(1)

    const second = await syncPage(fixture, page, await databaseNow())
    // The ids still come back, so the sync's `upserted` count is unchanged.
    expect(second.ids).toEqual(first.ids)
    expect(second.writes).toEqual({
      review: { inserted: 0, updated: 0, deleted: 0 },
      review_reply: { inserted: 0, updated: 0, deleted: 0 },
      review_media_item: { inserted: 0, updated: 0, deleted: 0 },
    })
  })

  it("rewrites only the review when the reviewer edits it", async () => {
    const fixture = await createFixture()
    const original = withReply(
      providerReview(reviewName(fixture), {
        reviewMediaItems: [{ thumbnailUrl: "https://example.test/photo.jpg" }],
      }),
      "Thanks for visiting!",
      "2026-09-02T10:00:00.000Z"
    )
    const reviewId = await ingest(fixture, original)

    const { writes } = await syncPage(
      fixture,
      [edited(original)],
      await databaseNow()
    )

    expect(writes.review.updated).toBe(1)
    expect(writes.review_reply).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 0,
    })
    expect(writes.review_media_item).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 0,
    })
    expect((await stored(reviewId)).text).toBe(
      "Lovely Sunday lunch, but the service was slow."
    )
  })

  // W8-04: the sync reads Google before the reply PUT lands, then commits
  // either side of the publish settle. The stale page is either exactly the
  // one already stored (the content-hash skip) or differs because the
  // reviewer edited the review meanwhile (the reply guard).
  describe.each([
    {
      scenario: "first reply, sync commits before the settle",
      existingReply: false,
      syncFirst: true,
    },
    {
      scenario: "first reply, sync commits after the settle",
      existingReply: false,
      syncFirst: false,
    },
    {
      scenario: "edited reply, sync commits before the settle",
      existingReply: true,
      syncFirst: true,
    },
    {
      scenario: "edited reply, sync commits after the settle",
      existingReply: true,
      syncFirst: false,
    },
  ])("$scenario", ({ existingReply, syncFirst }) => {
    it.each([
      { stalePage: "unchanged", reviewerEdited: false },
      { stalePage: "reviewer-edited", reviewerEdited: true },
    ])(
      "keeps the published reply ($stalePage stale page)",
      async ({ reviewerEdited }) => {
        const fixture = await createFixture()
        const base = providerReview(reviewName(fixture))
        const original = existingReply
          ? withReply(base, "Thanks!", "2026-09-02T10:00:00.000Z")
          : base
        const reviewId = await ingest(fixture, original)

        const fetchedAfter = await databaseNow()
        const stalePage = [reviewerEdited ? edited(original) : original]
        const intent = await publishIntent(fixture, reviewId, NEW_REPLY)
        if (syncFirst) {
          await syncPage(fixture, stalePage, fetchedAfter)
          await settlePublish(fixture, reviewId, intent, NEW_REPLY)
        } else {
          await settlePublish(fixture, reviewId, intent, NEW_REPLY)
          await syncPage(fixture, stalePage, fetchedAfter)
        }

        const afterRace = await stored(reviewId)
        expect(afterRace).toMatchObject({
          body: NEW_REPLY,
          replyStatus: "published",
          workflow: "published",
        })
        if (reviewerEdited) {
          // The review itself still takes the reviewer's edit.
          expect(afterRace.text).toBe(
            "Lovely Sunday lunch, but the service was slow."
          )
        }

        // The next sync reads Google after the PUT and agrees with it; the
        // one after that is a no-op.
        const fresh = withReply(
          reviewerEdited ? edited(original) : original,
          NEW_REPLY,
          "2026-10-14T10:00:00.000Z"
        )
        await syncPage(fixture, [fresh], await databaseNow())
        expect(await stored(reviewId)).toMatchObject({
          body: NEW_REPLY,
          workflow: "published",
        })
        const settled = await syncPage(fixture, [fresh], await databaseNow())
        expect(settled.writes.review.updated).toBe(0)
        expect(settled.writes.review_reply.updated).toBe(0)
      }
    )
  })

  it("keeps an in-flight reply even when the stale page is read after it", async () => {
    const fixture = await createFixture()
    const original = providerReview(reviewName(fixture))
    const reviewId = await ingest(fixture, original)
    const intent = await publishIntent(fixture, reviewId, NEW_REPLY)
    await admin`
      update publish_attempt
      set status = 'retryable', next_attempt_at = now() + interval '1 minute'
      where id = ${intent.attemptId}
    `

    // Fetched after the intent committed, but the PUT has not landed: a 429
    // parked it for the retry runner.
    await syncPage(fixture, [edited(original)], await databaseNow())

    expect(await stored(reviewId)).toMatchObject({
      body: NEW_REPLY,
      replyStatus: "accepted",
      workflow: "publish_requested",
      text: "Lovely Sunday lunch, but the service was slow.",
    })
  })

  it("still applies a reply Google deleted or edited", async () => {
    const fixture = await createFixture()
    const base = providerReview(reviewName(fixture))
    const reviewId = await ingest(
      fixture,
      withReply(base, "Thanks!", "2026-09-02T10:00:00.000Z")
    )
    expect(await stored(reviewId)).toMatchObject({
      body: "Thanks!",
      workflow: "published",
    })

    await syncPage(
      fixture,
      [withReply(base, "Thanks, see you soon!", "2026-09-03T10:00:00.000Z")],
      await databaseNow()
    )
    expect((await stored(reviewId)).body).toBe("Thanks, see you soon!")

    await syncPage(fixture, [base], await databaseNow())
    expect(await stored(reviewId)).toMatchObject({
      body: null,
      replyStatus: "deleted",
      workflow: "new",
    })
  })

  it("renews a lagging retention clock without touching the reply or photos", async () => {
    const fixture = await createFixture()
    const review = withReply(
      providerReview(reviewName(fixture), {
        reviewMediaItems: [{ thumbnailUrl: "https://example.test/photo.jpg" }],
      }),
      "Thanks!",
      "2026-09-02T10:00:00.000Z"
    )
    const reviewId = await ingest(fixture, review)
    await admin`
      update review
      set raw_content_expires_at = now() + interval '20 days'
      where id = ${reviewId}
    `

    const { writes } = await syncPage(fixture, [review], await databaseNow())

    expect(writes.review.updated).toBe(1)
    expect(writes.review_reply.updated).toBe(0)
    expect(writes.review_media_item).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 0,
    })
    const [renewed] = await admin<{ renewed: boolean }[]>`
      select raw_content_expires_at > now() + interval '29 days' as renewed
      from review
      where id = ${reviewId}
    `
    expect(renewed.renewed).toBe(true)
  })

  it("restores content the retention purge removed from a live review", async () => {
    const fixture = await createFixture()
    const review = providerReview(reviewName(fixture), {
      reviewMediaItems: [{ thumbnailUrl: "https://example.test/photo.jpg" }],
    })
    const reviewId = await ingest(fixture, review)
    // What retention/purge.ts does once raw_content_expires_at passes.
    await admin`delete from review_media_item where review_id = ${reviewId}`
    await admin`
      update review
      set
        review_text = null,
        reviewer_display_name = null,
        reviewer_profile_photo_url = null,
        raw_payload = null
      where id = ${reviewId}
    `

    await syncPage(fixture, [review], await databaseNow())

    const [restored] = await admin<
      { text: string | null; media: number; hasPayload: boolean }[]
    >`
      select
        r.review_text as text,
        (select count(*)::int from review_media_item m where m.review_id = r.id)
          as media,
        r.raw_payload is not null as "hasPayload"
      from review r
      where r.id = ${reviewId}
    `
    expect(restored).toEqual({
      text: "Lovely Sunday lunch.",
      media: 1,
      hasPayload: true,
    })
  })

  describe("through the sync route", () => {
    let stub: GoogleStub
    let server: Awaited<ReturnType<typeof startAppServer>>

    beforeAll(async () => {
      stub = await startGoogleStub()
      server = await startAppServer({
        GOOGLE_API_PROXY_BASE: stub.baseUrl,
        GOOGLE_TIMEOUT_MS: "3000",
      })
    })

    afterAll(async () => {
      await server.stop()
      await stub.stop()
    })

    function serve(page: Payload[]) {
      stub.reset()
      const handler = (): GoogleStubResponse => ({
        status: 200,
        json: { reviews: page },
      })
      stub.respond({ method: "GET", pathIncludes: "/reviews" }, handler)
    }

    async function backfill(fixture: Fixture) {
      const response = await fetch(`${server.baseUrl}/api/sync/backfill`, {
        method: "POST",
        headers: {
          cookie: fixture.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          externalLocationIds: [fixture.linked.externalLocationId],
          maxPagesPerLocation: 1,
        }),
      })
      expect(response.status, await response.clone().text()).toBe(200)
    }

    async function rowVersions(fixture: Fixture) {
      return admin<{ id: string; version: string }[]>`
        select id::text as id, xmin::text as version
        from review
        where external_location_id = ${fixture.linked.externalLocationId}
        order by id
      `
    }

    it("leaves unchanged reviews untouched and applies a Google-side reply deletion", async () => {
      const fixture = await createFixture()
      const plain = providerReview(reviewName(fixture))
      const replied = withReply(
        providerReview(reviewName(fixture)),
        "Thanks for visiting!",
        "2026-09-02T10:00:00.000Z"
      )
      serve([plain, replied])
      await backfill(fixture)
      const before = await rowVersions(fixture)
      expect(before).toHaveLength(3)

      await backfill(fixture)
      expect(await rowVersions(fixture)).toEqual(before)

      const replyRemoved = { ...replied }
      delete replyRemoved.reviewReply
      serve([plain, replyRemoved])
      await backfill(fixture)
      const [reply] = await admin<
        { body: string | null; status: string; workflow: string }[]
      >`
        select
          rr.current_body as body,
          rr.publish_status as status,
          r.workflow_status as workflow
        from review r
        join review_reply rr on rr.review_id = r.id
        where r.external_location_id = ${fixture.linked.externalLocationId}
      `
      expect(reply).toEqual({ body: null, status: "deleted", workflow: "new" })
    }, 30_000)
  })
})
