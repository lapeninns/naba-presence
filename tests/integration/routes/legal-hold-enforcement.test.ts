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

import { purgeOrganisation } from "@/lib/server/retention/purge"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

/**
 * Legal holds enforced by the database (0141, audit R2B-01): a hold that
 * commits while a retention round or an erasure is already working on its
 * review wins, a delete can never take a hold with it, and released holds
 * still go with their review.
 *
 * The races are made deterministic with a second connection: it applies the
 * hold in an open transaction, the purge or erasure starts and blocks on the
 * review row, and only then is the hold committed.
 */
describeDatabase("legal hold enforcement", () => {
  let admin: ReturnType<typeof postgres>
  let holder: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, {
      max: 1,
      prepare: false,
    })
    holder = postgres(process.env.DIRECT_DATABASE_URL!, {
      max: 1,
      prepare: false,
    })
    runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, {
      max: 1,
      prepare: false,
    })
    server = await startAppServer()
  })

  afterAll(async () => {
    await server?.stop()
    await destroyTenants(admin, organisations)
    await Promise.all([admin?.end(), holder?.end(), runtime?.end()])
  })

  async function disconnectedReview() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const review = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    return { owner, connection, review }
  }

  async function disconnect(connectionId: string) {
    await admin`
      update google_connection
      set
        status = 'disconnected',
        disconnected_at = now() - interval '8 days',
        purge_due_at = now() - interval '1 day'
      where id = ${connectionId}
    `
  }

  /**
   * Applies a hold in a transaction left open until `commit` is called, the
   * way an operator's insert or the hold route would, and resolves with the
   * holding backend's pid once the insert has run.
   */
  async function openHold(input: {
    organisationId: string
    reviewId: string
    approvedBy: string
  }) {
    let commit!: () => void
    const committed = new Promise<void>((resolve) => {
      commit = resolve
    })
    let started!: (pid: number) => void
    const pid = new Promise<number>((resolve) => {
      started = resolve
    })
    const done = holder.begin(async (sql) => {
      const [row] = await sql<{ pid: number }[]>`
        select pg_backend_pid() as pid
      `
      await sql`
        insert into legal_hold (organisation_id, review_id, reason, approved_by)
        values (
          ${input.organisationId},
          ${input.reviewId},
          'Hold applied mid-sweep.',
          ${input.approvedBy}
        )
      `
      started(row!.pid)
      await committed
    })
    return { pid: await pid, commit, done }
  }

  /** Waits until some other backend is blocked behind `pid`'s locks. */
  async function blockedBehind(pid: number) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [row] = await admin<{ waiting: number }[]>`
        select count(*)::int as waiting
        from pg_stat_activity
        where ${pid} = any(pg_blocking_pids(pid))
      `
      if ((row?.waiting ?? 0) > 0) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`nothing blocked behind backend ${pid}`)
  }

  async function holdsOn(reviewId: string) {
    const rows = await admin<{ released: boolean }[]>`
      select released_at is not null as released
      from legal_hold where review_id = ${reviewId}
    `
    return rows
  }

  it("keeps a review, its location and the hold when the hold commits while the disconnected purge waits on it", async () => {
    const { owner, connection, review } = await disconnectedReview()
    await disconnect(connection.connectionId)

    const hold = await openHold({
      organisationId: owner.organisationId,
      reviewId: review.reviewId,
      approvedBy: owner.userId,
    })
    // The round's snapshot predates the hold, so its location still looks
    // unheld and disconnectedReviews goes for the review.
    const purge = purgeOrganisation({
      organisationId: owner.organisationId,
      requestId: `hold-race-delete-${randomUUID()}`,
      clientRequestId: null,
      deletesEnabled: true,
      deadline: 0,
    })
    await blockedBehind(hold.pid)
    hold.commit()
    await hold.done
    const result = await purge

    expect(result.counts.disconnectedReviews ?? 0).toBe(0)
    expect(result.counts.disconnectedLocations ?? 0).toBe(0)
    const [kept] = await admin<{ reviews: number; locations: number }[]>`
      select
        (select count(*)::int from review where id = ${review.reviewId})
          as reviews,
        (
          select count(*)::int from external_location
          where id = ${review.externalLocationId}
        ) as locations
    `
    expect(kept).toEqual({ reviews: 1, locations: 1 })
    expect(await holdsOn(review.reviewId)).toEqual([{ released: false }])

    // The next round sees the hold up front and keeps the location too.
    const next = await purgeOrganisation({
      organisationId: owner.organisationId,
      requestId: `hold-race-delete-next-${randomUUID()}`,
      clientRequestId: null,
      deletesEnabled: true,
      deadline: 0,
    })
    expect(next.counts.heldLocationsSkipped).toBe(1)
  }, 40_000)

  it("keeps a review's content when the hold commits while the redaction waits on it", async () => {
    const { owner, review } = await disconnectedReview()
    await admin`
      update review
      set
        review_text = 'Evidence the hold has to keep.',
        raw_payload = '{"kept": true}'::jsonb,
        raw_content_expires_at = now() - interval '1 day'
      where id = ${review.reviewId}
    `

    const hold = await openHold({
      organisationId: owner.organisationId,
      reviewId: review.reviewId,
      approvedBy: owner.userId,
    })
    const purge = purgeOrganisation({
      organisationId: owner.organisationId,
      requestId: `hold-race-redact-${randomUUID()}`,
      clientRequestId: null,
      deletesEnabled: true,
      deadline: 0,
    })
    await blockedBehind(hold.pid)
    hold.commit()
    await hold.done
    const result = await purge

    expect(result.counts.reviews ?? 0).toBe(0)
    const [row] = await admin<
      { text: string | null; name: string | null; payload: unknown }[]
    >`
      select
        review_text as text,
        reviewer_display_name as name,
        raw_payload as payload
      from review where id = ${review.reviewId}
    `
    expect(row).toEqual({
      text: "Evidence the hold has to keep.",
      name: "Stub reviewer",
      payload: { kept: true },
    })
    expect(await holdsOn(review.reviewId)).toEqual([{ released: false }])
  }, 40_000)

  async function expiredReviewWithMedia() {
    const { owner, review } = await disconnectedReview()
    await admin`
      update review
      set
        review_text = 'Evidence the hold has to keep.',
        raw_payload = '{"kept": true}'::jsonb,
        raw_content_expires_at = now() - interval '1 day'
      where id = ${review.reviewId}
    `
    await admin`
      insert into review_media_item (
        organisation_id, review_id, thumbnail_url, thumbnail_label
      )
      values (
        ${owner.organisationId}, ${review.reviewId},
        'https://example.test/evidence.jpg', 'Evidence photo'
      )
    `
    return { owner, review }
  }

  async function mediaOn(reviewId: string) {
    const [row] = await admin<{ media: number }[]>`
      select count(*)::int as media
      from review_media_item where review_id = ${reviewId}
    `
    return row!.media
  }

  it("keeps a review's media when the hold commits while the media step waits on it", async () => {
    const { owner, review } = await expiredReviewWithMedia()

    const hold = await openHold({
      organisationId: owner.organisationId,
      reviewId: review.reviewId,
      approvedBy: owner.userId,
    })
    // The media step runs before the review redaction, so it is the first
    // statement to reach the held review: review_media_legal_hold_guard
    // (0142) makes it wait for the hold instead of deleting past it.
    const purge = purgeOrganisation({
      organisationId: owner.organisationId,
      requestId: `hold-race-media-${randomUUID()}`,
      clientRequestId: null,
      deletesEnabled: true,
      deadline: 0,
    })
    await blockedBehind(hold.pid)
    hold.commit()
    await hold.done
    const result = await purge

    expect(result.counts.media ?? 0).toBe(0)
    expect(result.counts.reviews ?? 0).toBe(0)
    expect(await mediaOn(review.reviewId)).toBe(1)
    expect(await holdsOn(review.reviewId)).toEqual([{ released: false }])

    // The next round sees the hold up front and leaves the media alone.
    const next = await purgeOrganisation({
      organisationId: owner.organisationId,
      requestId: `hold-race-media-next-${randomUUID()}`,
      clientRequestId: null,
      deletesEnabled: true,
      deadline: Date.now() + 30_000,
    })
    expect(next.counts.media ?? 0).toBe(0)
    expect(await mediaOn(review.reviewId)).toBe(1)
  }, 40_000)

  it("still deletes an unheld review's expired media, and leaves non-retention media deletes alone", async () => {
    const { owner, review } = await expiredReviewWithMedia()

    const result = await purgeOrganisation({
      organisationId: owner.organisationId,
      requestId: `media-unheld-${randomUUID()}`,
      clientRequestId: null,
      deletesEnabled: true,
      deadline: Date.now() + 30_000,
    })
    expect(result.counts.media).toBe(1)
    expect(await mediaOn(review.reviewId)).toBe(0)

    // Outside a retention round the guard does not fire: a sync replacing
    // a held review's media is unaffected.
    const held = await expiredReviewWithMedia()
    await admin`
      insert into legal_hold (organisation_id, review_id, reason, approved_by)
      values (
        ${held.owner.organisationId}, ${held.review.reviewId},
        'Held during sync.', ${held.owner.userId}
      )
    `
    await admin`
      delete from review_media_item where review_id = ${held.review.reviewId}
    `
    expect(await mediaOn(held.review.reviewId)).toBe(0)
  }, 40_000)

  it("still purges a disconnected review whose holds were all released, with the released hold", async () => {
    const { owner, connection, review } = await disconnectedReview()
    await admin`
      insert into legal_hold (
        organisation_id, review_id, reason, approved_by, released_by, released_at
      )
      values (
        ${owner.organisationId}, ${review.reviewId}, 'Matter closed.',
        ${owner.userId}, ${owner.userId}, now()
      )
    `
    await disconnect(connection.connectionId)

    const result = await purgeOrganisation({
      organisationId: owner.organisationId,
      requestId: `released-hold-${randomUUID()}`,
      clientRequestId: null,
      deletesEnabled: true,
      deadline: Date.now() + 30_000,
    })
    expect(result.complete).toBe(true)
    expect(result.counts.disconnectedReviews).toBe(1)
    expect(result.counts.disconnectedLocations).toBe(1)
    const [gone] = await admin<{ reviews: number }[]>`
      select count(*)::int as reviews from review where id = ${review.reviewId}
    `
    expect(gone?.reviews).toBe(0)
    expect(await holdsOn(review.reviewId)).toEqual([])
  }, 40_000)

  it("refuses to delete or erase a held review outside retention, lets the sync refresh it, and lets its organisation go", async () => {
    const { owner, review } = await disconnectedReview()
    await admin`
      insert into legal_hold (organisation_id, review_id, reason, approved_by)
      values (
        ${owner.organisationId}, ${review.reviewId}, 'Litigation hold.',
        ${owner.userId}
      )
    `
    const asTenant = <T>(
      fn: (sql: postgres.TransactionSql) => Promise<T>
    ): Promise<T> =>
      runtime.begin(async (sql) => {
        await sql`
          select set_config('app.organisation_id', ${owner.organisationId}, true)
        `
        return fn(sql)
      }) as Promise<T>

    await expect(
      asTenant((sql) => sql`delete from review where id = ${review.reviewId}`)
    ).rejects.toMatchObject({
      code: "23514",
      message: "review_legal_hold",
      detail: review.reviewId,
    })
    await expect(
      asTenant(
        (sql) => sql`
          update review
          set reviewer_display_name = 'Removed reviewer',
              review_text = null, raw_payload = null, erased_at = now()
          where id = ${review.reviewId}
        `
      )
    ).rejects.toMatchObject({ message: "review_legal_hold" })
    // A delete cascading from its location is refused, never skipped, even
    // inside a retention round: skipping it would orphan the review.
    await expect(
      asTenant(async (sql) => {
        await sql`select set_config('app.retention_run', 'true', true)`
        await sql`
          delete from external_location
          where id = ${review.externalLocationId}
        `
      })
    ).rejects.toMatchObject({ message: "review_legal_hold" })
    // No delete path can take the hold away either.
    await expect(
      admin`delete from review where id = ${review.reviewId}`
    ).rejects.toMatchObject({ message: "review_legal_hold" })

    // The sync's refresh always writes a payload, so it is not a redaction.
    const refreshed = await asTenant(
      (sql) => sql`
        update review
        set review_text = 'Edited by the reviewer.',
            raw_payload = '{"edited": true}'::jsonb
        where id = ${review.reviewId}
        returning id
      `
    )
    expect(refreshed.count).toBe(1)

    // Deleting the organisation takes its holds with it.
    await admin.begin(async (sql) => {
      await sql`alter table audit_log disable trigger audit_log_no_update`
      await sql`delete from organisation where id = ${owner.organisationId}`
      await sql`alter table audit_log enable trigger audit_log_no_update`
    })
    expect(await holdsOn(review.reviewId)).toEqual([])
  }, 40_000)

  it("refuses an erasure the hold commits under while the fulfil waits on the review", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const review = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      text: "Content an erasure must not reach.",
    })
    const subject = `Held subject ${randomUUID()}`
    await admin`
      update review set reviewer_display_name = ${subject}
      where id = ${review.reviewId}
    `
    const headers = {
      cookie: owner.cookie,
      "content-type": "application/json",
    }
    const created = await fetch(`${server.baseUrl}/api/privacy/requests`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestType: "erasure",
        subjectReference: subject,
      }),
    })
    expect(created.status).toBe(201)
    const { request } = (await created.json()) as { request: { id: string } }
    const previewed = await fetch(
      `${server.baseUrl}/api/privacy/requests/${request.id}/preview`,
      { headers }
    )
    expect(previewed.status).toBe(200)
    const { preview } = (await previewed.json()) as {
      preview: { reviews: number; heldReviews: number; confirmation: string }
    }
    expect(preview).toMatchObject({ reviews: 1, heldReviews: 0 })

    const hold = await openHold({
      organisationId: owner.organisationId,
      reviewId: review.reviewId,
      approvedBy: owner.userId,
    })
    const fulfil = fetch(`${server.baseUrl}/api/privacy/requests`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        id: request.id,
        action: "fulfil",
        resolutionNote: "Identity verified.",
        confirmation: preview.confirmation,
      }),
    })
    await blockedBehind(hold.pid)
    hold.commit()
    await hold.done
    const response = await fulfil

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: "privacy_legal_hold",
      holds: [review.reviewId],
    })
    const [row] = await admin<
      { text: string | null; name: string | null; erased: boolean }[]
    >`
      select
        review_text as text,
        reviewer_display_name as name,
        erased_at is not null as erased
      from review where id = ${review.reviewId}
    `
    expect(row).toEqual({
      text: "Content an erasure must not reach.",
      name: subject,
      erased: false,
    })
  }, 40_000)
})
