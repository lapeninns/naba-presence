import { randomBytes, randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { sha256 } from "@/lib/server/crypto"
import { upsertGoogleReview } from "@/lib/server/reviews"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
  seedLinkedReview,
  seedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const DAY_MS = 24 * 60 * 60 * 1000

describeDatabase("privacy fulfilment and audit retention", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, {
      max: 1,
      prepare: false,
    })
    runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, {
      max: 1,
      prepare: false,
    })
    // An erasure whose reply is still live at Google drives the reply-delete
    // pipeline, so this suite needs a provider to answer.
    stub = await startGoogleStub()
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: stub.baseUrl })
  })

  afterAll(async () => {
    await server?.stop()
    await stub?.stop()
    await destroyTenants(admin, organisations)
    await Promise.all([admin?.end(), runtime?.end()])
  })

  async function createActor(
    organisationId: string,
    role: "owner" | "admin" | "member" | "viewer"
  ) {
    const userId = randomUUID()
    const token = randomBytes(32).toString("base64url")
    await admin`
      insert into app_user (
        id,
        email,
        display_name,
        default_organisation_id
      )
      values (
        ${userId},
        ${`privacy-${userId.slice(0, 8)}@nabapresence.test`},
        'Privacy actor',
        ${organisationId}
      )
    `
    await admin`
      insert into member (organisation_id, user_id, role, can_publish)
      values (${organisationId}, ${userId}, ${role}, ${role === "owner"})
    `
    await admin`
      insert into app_session (
        token_hash,
        user_id,
        organisation_id,
        expires_at
      )
      values (
        ${sha256(token)},
        ${userId},
        ${organisationId},
        now() + interval '1 hour'
      )
    `
    return { userId, cookie: `naba_session=${token}` }
  }

  async function createFixture() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const review = await seedReview(admin, {
      organisationId: owner.organisationId,
    })
    const reviewerName = `Privacy reviewer ${randomUUID()}`
    await admin`
      update review
      set
        reviewer_display_name = ${reviewerName},
        review_text = 'Private review content',
        raw_payload = '{"private":"payload"}'::jsonb
      where id = ${review.reviewId}
    `
    return { owner, review, reviewerName }
  }

  async function createRequest(
    cookie: string,
    requestType: "access" | "rectification" | "erasure" | "restriction",
    subjectReference: string
  ) {
    const response = await fetch(`${server.baseUrl}/api/privacy/requests`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        requestType,
        subjectReference,
        reason: "Verified privacy request.",
      }),
    })
    expect(response.status).toBe(201)
    return (await response.json()).request as {
      id: string
      dueAt: string
      createdAt: string
    }
  }

  async function runRetention() {
    const organisations: {
      organisationId: string
      profileSnapshots: number
    }[] = []
    let cursor: string | null = null
    do {
      const query = new URLSearchParams({ batch_size: "100" })
      // A hand-run page (an explicit cursor, empty for the head), so the
      // walk covers the whole fleet now instead of waiting for the cycle.
      query.set("cursor", cursor ?? "")
      const response = await fetch(
        `${server.baseUrl}/api/cron/retention?${query}`,
        {
          method: "POST",
          headers: { authorization: "Bearer route-harness-cron-secret" },
        }
      )
      expect(response.status).toBe(200)
      const payload = (await response.json()) as {
        organisations: typeof organisations
        nextCursor: string | null
      }
      organisations.push(...payload.organisations)
      cursor = payload.nextCursor
    } while (cursor)
    return organisations
  }

  async function preview(cookie: string, id: string, baseUrl = server.baseUrl) {
    return fetch(`${baseUrl}/api/privacy/requests/${id}/preview`, {
      headers: { cookie },
    })
  }

  /**
   * Fulfils the way the console does: reads the preview first and sends its
   * confirmation back. A caller the preview refuses (an admin) fulfils
   * without one and meets the PATCH's own refusal.
   */
  async function fulfil(
    cookie: string,
    id: string,
    resolutionNote = "Fulfilled.",
    baseUrl = server.baseUrl
  ) {
    const previewed = await preview(cookie, id, baseUrl)
    const confirmation = previewed.ok
      ? ((await previewed.json()) as { preview: { confirmation: string } })
          .preview.confirmation
      : undefined
    return fetch(`${baseUrl}/api/privacy/requests`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        id,
        action: "fulfil",
        resolutionNote,
        confirmation,
      }),
    })
  }

  function changeStatus(
    cookie: string,
    id: string,
    status: "pending" | "in_progress" | "completed" | "rejected",
    resolutionNote = "Recorded from the compliance console."
  ) {
    return fetch(`${server.baseUrl}/api/privacy/requests`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ id, status, resolutionNote }),
    })
  }

  /**
   * The three places the reviewer's name is copied to once a reply exists:
   * the draft it was generated into, the reply body, and the queued attempt
   * that would replay it at Google.
   */
  async function seedDerivedBodies(input: {
    organisationId: string
    reviewId: string
    body: string
    publishStatus: string
  }) {
    const [draft] = await admin<{ id: string }[]>`
      insert into draft (
        organisation_id, review_id, source, body, body_bytes, evidence_hash
      )
      values (
        ${input.organisationId},
        ${input.reviewId},
        'template',
        ${input.body},
        ${Buffer.byteLength(input.body)},
        ${sha256(input.body)}
      )
      returning id::text as id
    `
    const [reply] = await admin<{ id: string }[]>`
      insert into review_reply (
        organisation_id, review_id, current_body, publish_status
      )
      values (
        ${input.organisationId},
        ${input.reviewId},
        ${input.body},
        ${input.publishStatus}
      )
      returning id::text as id
    `
    const [attempt] = await admin<{ id: string }[]>`
      insert into publish_attempt (
        organisation_id, review_reply_id, draft_id, idempotency_key,
        request_body_hash, status, attempt_no, operation, intended_body,
        next_attempt_at, publish_generation
      )
      values (
        ${input.organisationId},
        ${reply.id},
        ${draft.id},
        ${sha256(`${input.reviewId}:publish:0`)},
        ${sha256(input.body)},
        'retryable',
        1,
        'publish',
        ${input.body},
        now() + interval '5 minutes',
        0
      )
      returning id::text as id
    `
    return { draftId: draft.id, replyId: reply.id, attemptId: attempt.id }
  }

  it("anonymizes erasure matches, removes media, and audits counts", async () => {
    const fixture = await createFixture()
    await admin`
      insert into review_media_item (
        organisation_id,
        review_id,
        thumbnail_url,
        thumbnail_label
      )
      values (
        ${fixture.owner.organisationId},
        ${fixture.review.reviewId},
        'https://example.test/private.jpg',
        'Private media'
      )
    `
    const request = await createRequest(
      fixture.owner.cookie,
      "erasure",
      fixture.reviewerName
    )
    const response = await fulfil(fixture.owner.cookie, request.id)
    expect(response.status).toBe(200)

    const [review] = await admin`
      select
        reviewer_display_name as "reviewerDisplayName",
        review_text as text,
        raw_payload as "rawPayload"
      from review
      where id = ${fixture.review.reviewId}
    `
    expect(review).toEqual({
      reviewerDisplayName: "Removed reviewer",
      text: null,
      rawPayload: null,
    })
    const [photo] = await admin<{ photo: string | null }[]>`
      select reviewer_profile_photo_url as photo
      from review
      where id = ${fixture.review.reviewId}
    `
    expect(photo.photo).toBeNull()
    const [{ mediaCount }] = await admin<{ mediaCount: number }[]>`
      select count(*)::integer as "mediaCount"
      from review_media_item
      where review_id = ${fixture.review.reviewId}
    `
    expect(mediaCount).toBe(0)
    const [privacyRequest] = await admin`
      select status
      from privacy_request
      where id = ${request.id}
    `
    expect(privacyRequest.status).toBe("completed")
    const [audit] = await admin<{ metadata: { reviewsAffected?: number } }[]>`
      select metadata
      from audit_log
      where organisation_id = ${fixture.owner.organisationId}
        and action = 'privacy.request.fulfilled'
        and subject_id = ${request.id}
    `
    expect(audit.metadata.reviewsAffected).toBe(1)
  })

  it("previews an erasure's matches and erases only the confirmed set", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const sharedName = `Sam Shared ${randomUUID()}`
    // Two people who share a display name, at two locations, one of whom
    // has a live reply that the erasure would withdraw.
    const first = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      replyState: "APPROVED",
    })
    const second = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    await admin`
      update review
      set
        reviewer_display_name = ${sharedName},
        reviewer_profile_photo_url = 'https://example.test/' || id::text
      where id in ${admin([first.reviewId, second.reviewId])}
    `
    const request = await createRequest(owner.cookie, "erasure", sharedName)

    const previewed = await preview(owner.cookie, request.id)
    expect(previewed.status).toBe(200)
    const { preview: counts } = (await previewed.json()) as {
      preview: Record<string, number | string>
    }
    expect(counts).toMatchObject({
      reviews: 2,
      reviewers: 2,
      matchedByNameOnly: 2,
      locations: 2,
      repliesToWithdraw: 1,
      heldReviews: 0,
    })

    const send = (confirmation?: string) =>
      fetch(`${server.baseUrl}/api/privacy/requests`, {
        method: "PATCH",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          id: request.id,
          action: "fulfil",
          resolutionNote: "Identity verified.",
          confirmation,
        }),
      })
    const untouched = async () => {
      const rows = await admin<{ name: string | null }[]>`
        select reviewer_display_name as name from review
        where id in ${admin([first.reviewId, second.reviewId])}
      `
      expect(rows.map(({ name }) => name)).toEqual([sharedName, sharedName])
    }

    // Without a confirmation nothing is erased, and the 409 carries the
    // current preview.
    const blind = await send()
    expect(blind.status).toBe(409)
    expect(await blind.json()).toMatchObject({
      error: "privacy_erasure_unconfirmed",
      preview: { reviews: 2, confirmation: counts.confirmation },
    })
    await untouched()

    // A third same-named review arrives after the preview: the confirmation
    // no longer names the match set, so it is refused and counted again.
    const third = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    await admin`
      update review set reviewer_display_name = ${sharedName}
      where id = ${third.reviewId}
    `
    const stale = await send(String(counts.confirmation))
    expect(stale.status).toBe(409)
    const restated = (await stale.json()) as {
      preview: { reviews: number; confirmation: string }
    }
    expect(restated.preview.reviews).toBe(3)
    expect(restated.preview.confirmation).not.toBe(counts.confirmation)
    await untouched()

    const confirmed = await send(restated.preview.confirmation)
    expect([200, 409]).toContain(confirmed.status)
    const erased = await admin<{ erased: boolean }[]>`
      select erased_at is not null as erased from review
      where id in ${admin([first.reviewId, second.reviewId, third.reviewId])}
    `
    expect(erased.every(({ erased }) => erased)).toBe(true)
  })

  it("is owner-only, and 404s for another organisation's request", async () => {
    const fixture = await createFixture()
    const request = await createRequest(
      fixture.owner.cookie,
      "erasure",
      fixture.reviewerName
    )
    const actor = await createActor(fixture.owner.organisationId, "admin")
    expect((await preview(actor.cookie, request.id)).status).toBe(403)
    const stranger = await createTestTenant(admin)
    organisations.push(stranger.organisationId)
    expect((await preview(stranger.cookie, request.id)).status).toBe(404)
  })

  it("scrubs the verifier's reason messages, keeping codes and severities", async () => {
    const fixture = await createFixture()
    const derived = await seedDerivedBodies({
      organisationId: fixture.owner.organisationId,
      reviewId: fixture.review.reviewId,
      body: `Thanks ${fixture.reviewerName}, glad you enjoyed it.`,
      publishStatus: "not_published",
    })
    const [verification] = await admin<{ id: string }[]>`
      insert into verification_result (
        organisation_id, draft_id, verdict, reasons, checks_version
      )
      values (
        ${fixture.owner.organisationId},
        ${derived.draftId},
        'fail',
        ${admin.json([
          {
            code: "unsupported_claim",
            severity: "fail",
            message: `The reply says ${fixture.reviewerName} visited twice.`,
          },
          {
            code: "personal_contact_data",
            severity: "fail",
            message: "The reply contains an email address or phone number.",
          },
        ])},
        'test-checks'
      )
      returning id::text as id
    `
    const request = await createRequest(
      fixture.owner.cookie,
      "erasure",
      fixture.reviewerName
    )
    expect((await fulfil(fixture.owner.cookie, request.id)).status).toBe(200)

    const [row] = await admin<
      {
        verdict: string
        reasons: { code: string; severity: string; message: string }[]
      }[]
    >`
      select verdict, reasons from verification_result
      where id = ${verification.id}
    `
    expect(row.verdict).toBe("fail")
    expect(row.reasons).toEqual([
      {
        code: "unsupported_claim",
        severity: "fail",
        message: "[Removed at the data subject's request]",
      },
      {
        code: "personal_contact_data",
        severity: "fail",
        message: "[Removed at the data subject's request]",
      },
    ])
    expect(JSON.stringify(row.reasons)).not.toContain(fixture.reviewerName)
    const [audit] = await admin<
      { metadata: { verificationsRedacted?: number } }[]
    >`
      select metadata from audit_log
      where organisation_id = ${fixture.owner.organisationId}
        and action = 'privacy.request.fulfilled'
        and subject_id = ${request.id}
    `
    expect(audit.metadata.verificationsRedacted).toBe(1)
  })

  it("blocks erasure under a hold, then releases and fulfils it", async () => {
    const fixture = await createFixture()
    const request = await createRequest(
      fixture.owner.cookie,
      "erasure",
      fixture.reviewerName
    )
    await admin`
      insert into legal_hold (
        organisation_id,
        review_id,
        reason,
        approved_by
      )
      values (
        ${fixture.owner.organisationId},
        ${fixture.review.reviewId},
        'Active dispute',
        ${fixture.owner.userId}
      )
    `
    const response = await fulfil(fixture.owner.cookie, request.id)
    expect(response.status).toBe(409)
    const payload = await response.json()
    expect(payload.error).toBe("privacy_legal_hold")
    expect(payload.holds).toEqual([fixture.review.reviewId])

    const [review] = await admin`
      select reviewer_display_name as "reviewerDisplayName", review_text as text
      from review
      where id = ${fixture.review.reviewId}
    `
    expect(review).toEqual({
      reviewerDisplayName: fixture.reviewerName,
      text: "Private review content",
    })
    const [privacyRequest] = await admin`
      select status
      from privacy_request
      where id = ${request.id}
    `
    expect(privacyRequest.status).toBe("pending")

    const releaseResponse = await fetch(`${server.baseUrl}/api/legal-holds`, {
      method: "DELETE",
      headers: {
        cookie: fixture.owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ reviewId: fixture.review.reviewId }),
    })
    expect(releaseResponse.status).toBe(200)
    expect(await releaseResponse.json()).toEqual({ released: true })

    const fulfilledResponse = await fulfil(
      fixture.owner.cookie,
      request.id,
      "Legal hold released; erasure fulfilled."
    )
    expect(fulfilledResponse.status).toBe(200)

    const [anonymizedReview] = await admin`
      select reviewer_display_name as "reviewerDisplayName", review_text as text
      from review
      where id = ${fixture.review.reviewId}
    `
    expect(anonymizedReview).toEqual({
      reviewerDisplayName: "Removed reviewer",
      text: null,
    })
  })

  it("restricts matching reviews, blocks drafts, and flags exports", async () => {
    const fixture = await createFixture()
    const request = await createRequest(
      fixture.owner.cookie,
      "restriction",
      fixture.reviewerName
    )
    const response = await fulfil(fixture.owner.cookie, request.id)
    expect(response.status).toBe(200)
    const [review] = await admin<{ restrictedAt: Date | null }[]>`
      select restricted_at as "restrictedAt"
      from review
      where id = ${fixture.review.reviewId}
    `
    expect(review.restrictedAt).toBeInstanceOf(Date)

    const draftResponse = await fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}/drafts`,
      {
        method: "POST",
        headers: {
          cookie: fixture.owner.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ body: "A human-written reply." }),
      }
    )
    expect(draftResponse.status).toBe(409)
    expect((await draftResponse.json()).error).toBe("review_restricted")

    const exportResponse = await fetch(`${server.baseUrl}/api/privacy/export`, {
      method: "POST",
      headers: {
        cookie: fixture.owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ subject: fixture.reviewerName }),
    })
    expect(exportResponse.status).toBe(200)
    expect(exportResponse.headers.get("content-disposition")).toContain(
      "attachment"
    )
    expect(exportResponse.headers.get("cache-control")).toBe(
      "private, no-store"
    )
    expect((await exportResponse.json()).reviews[0].restrictedAt).toEqual(
      expect.any(String)
    )

    // A GET with a subject query string is gone — no PII-in-URL surface remains.
    const legacyResponse = await fetch(
      `${server.baseUrl}/api/privacy/export?subject=${encodeURIComponent(fixture.reviewerName)}`,
      { headers: { cookie: fixture.owner.cookie } }
    )
    expect(legacyResponse.status).toBe(405)
  })

  it("does not allow an admin to fulfil requests", async () => {
    const fixture = await createFixture()
    const request = await createRequest(
      fixture.owner.cookie,
      "erasure",
      fixture.reviewerName
    )
    const actor = await createActor(fixture.owner.organisationId, "admin")
    const response = await fulfil(actor.cookie, request.id)
    expect(response.status).toBe(403)
  })

  it("completes access requests without mutation and bounds audit strings", async () => {
    const fixture = await createFixture()
    const request = await createRequest(
      fixture.owner.cookie,
      "access",
      fixture.reviewerName
    )
    const response = await fulfil(
      fixture.owner.cookie,
      request.id,
      "A".repeat(350)
    )
    expect(response.status).toBe(200)
    const [review] = await admin`
      select reviewer_display_name as "reviewerDisplayName", review_text as text
      from review
      where id = ${fixture.review.reviewId}
    `
    expect(review).toEqual({
      reviewerDisplayName: fixture.reviewerName,
      text: "Private review content",
    })
    const [audit] = await admin<{ resolutionNote: string }[]>`
      select metadata->>'resolutionNote' as "resolutionNote"
      from audit_log
      where organisation_id = ${fixture.owner.organisationId}
        and action = 'privacy.request.fulfilled'
        and subject_id = ${request.id}
    `
    expect(audit.resolutionNote).toHaveLength(200)
  })

  it("retains bounded audit history and keeps manual deletes forbidden", async () => {
    const fixture = await createFixture()
    const oldSubjectId = `old-${randomUUID()}`
    const recentSubjectId = `recent-${randomUUID()}`
    await admin`
      insert into audit_log (
        organisation_id,
        action,
        subject_type,
        subject_id,
        request_id,
        created_at
      )
      values
        (
          ${fixture.owner.organisationId},
          'privacy.retention.fixture',
          'review',
          ${oldSubjectId},
          ${randomUUID()},
          now() - interval '400 days'
        ),
        (
          ${fixture.owner.organisationId},
          'privacy.retention.fixture',
          'review',
          ${recentSubjectId},
          ${randomUUID()},
          now() - interval '100 days'
        )
    `
    await runRetention()
    const rows = await admin<{ subject_id: string }[]>`
      select subject_id
      from audit_log
      where organisation_id = ${fixture.owner.organisationId}
        and action = 'privacy.retention.fixture'
      order by subject_id
    `
    expect(rows.map((row) => row.subject_id)).toEqual([recentSubjectId])

    await expect(
      runtime.begin(async (sql) => {
        await sql`
          select set_config(
            'app.organisation_id',
            ${fixture.owner.organisationId},
            true
          )
        `
        await sql`
          delete from audit_log
          where organisation_id = ${fixture.owner.organisationId}
            and subject_id = ${recentSubjectId}
        `
      })
    ).rejects.toThrow(/audit_log is append-only/)
  })

  it("purges expired profile snapshots without violating snapshot_expires_at", async () => {
    const fixture = await createFixture()
    const connection = await seedGoogleConnection(admin, {
      organisationId: fixture.owner.organisationId,
    })
    const linked = await seedLinkedLocation(admin, {
      organisationId: fixture.owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const [state] = await admin<{ id: string }[]>`
      insert into profile_field_state (
        organisation_id,
        location_id,
        external_location_id,
        field_key,
        policy,
        status,
        canonical_value,
        google_value,
        canonical_hash,
        google_hash,
        canonical_revision,
        snapshot_expires_at
      )
      values (
        ${fixture.owner.organisationId},
        ${linked.locationId},
        ${linked.externalLocationId},
        'name',
        'bidirectional',
        'in_sync',
        '{"value":"Expired canonical name"}'::jsonb,
        '{"value":"Expired google name"}'::jsonb,
        'canonical-hash',
        'google-hash',
        '1',
        now() - interval '1 day'
      )
      returning id
    `

    const first = await runRetention()
    expect(
      first.find(
        (entry) => entry.organisationId === fixture.owner.organisationId
      )?.profileSnapshots
    ).toBe(1)

    const [purged] = await admin<
      {
        canonicalValue: unknown
        googleValue: unknown
        snapshotExpiresAt: Date | null
      }[]
    >`
      select
        canonical_value as "canonicalValue",
        google_value as "googleValue",
        snapshot_expires_at as "snapshotExpiresAt"
      from profile_field_state
      where id = ${state.id}
    `
    expect(purged.canonicalValue).toBeNull()
    expect(purged.googleValue).toBeNull()
    expect(purged.snapshotExpiresAt).toBeInstanceOf(Date)

    // Already-cleared rows are not counted again on the next run.
    const second = await runRetention()
    expect(
      second.find(
        (entry) => entry.organisationId === fixture.owner.organisationId
      )?.profileSnapshots ?? 0
    ).toBe(0)
  })

  it("guards formula-prefixed values in the routed audit CSV export", async () => {
    const fixture = await createFixture()
    const formula = "=SUM(A1)"
    await admin`
      insert into audit_log (
        organisation_id,
        action,
        subject_type,
        subject_id,
        request_id
      )
      values (
        ${fixture.owner.organisationId},
        ${formula},
        'review',
        ${fixture.review.reviewId},
        ${randomUUID()}
      )
    `

    const response = await fetch(
      `${server.baseUrl}/api/audit-log?format=csv&action=${encodeURIComponent(formula)}`,
      { headers: { cookie: fixture.owner.cookie } }
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/csv")
    expect(await response.text()).toContain(`\"'${formula}\"`)
  })

  it("redacts the derived draft, reply and attempt bodies", async () => {
    const fixture = await createFixture()
    const body = `Hi ${fixture.reviewerName}, thank you for your rating.`
    const seeded = await seedDerivedBodies({
      organisationId: fixture.owner.organisationId,
      reviewId: fixture.review.reviewId,
      body,
      // Never reached Google, so no withdrawal is needed and the request
      // completes in one call.
      publishStatus: "not_published",
    })
    const request = await createRequest(
      fixture.owner.cookie,
      "erasure",
      fixture.reviewerName
    )

    const response = await fulfil(fixture.owner.cookie, request.id)
    expect(response.status).toBe(200)
    expect((await response.json()).request.status).toBe("completed")

    const [draft] = await admin<{ body: string }[]>`
      select body from draft where id = ${seeded.draftId}
    `
    expect(draft.body).not.toContain(fixture.reviewerName)
    const [reply] = await admin<{ currentBody: string | null }[]>`
      select current_body as "currentBody"
      from review_reply
      where id = ${seeded.replyId}
    `
    expect(reply.currentBody).toBeNull()
    // The queued attempt is retired before its body is dropped: left armed
    // the runner would replay the erased name at Google.
    const [attempt] = await admin<
      { intendedBody: string | null; status: string; reason: string | null }[]
    >`
      select
        intended_body as "intendedBody",
        status,
        provider_error_code as reason
      from publish_attempt
      where id = ${seeded.attemptId}
    `
    expect(attempt).toEqual({
      intendedBody: null,
      status: "superseded",
      reason: "subject_erasure",
    })
    const [erased] = await admin<{ erasedAt: Date | null }[]>`
      select erased_at as "erasedAt"
      from review
      where id = ${fixture.review.reviewId}
    `
    expect(erased.erasedAt).toBeInstanceOf(Date)
    const [audit] = await admin<
      {
        metadata: {
          draftsRedacted?: number
          repliesRedacted?: number
          attemptBodiesRedacted?: number
        }
      }[]
    >`
      select metadata
      from audit_log
      where organisation_id = ${fixture.owner.organisationId}
        and action = 'privacy.request.fulfilled'
        and subject_id = ${request.id}
    `
    expect(audit.metadata.draftsRedacted).toBe(1)
    expect(audit.metadata.repliesRedacted).toBe(1)
    expect(audit.metadata.attemptBodiesRedacted).toBe(1)
  })

  it("keeps an erased review redacted when Google re-ingests it", async () => {
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
    const reviewerName = `Reingested reviewer ${randomUUID()}`
    const payload = {
      name: seed.googleReviewName,
      reviewId: seed.reviewId,
      reviewer: {
        displayName: reviewerName,
        profilePhotoUrl: "https://example.test/avatar.jpg",
      },
      starRating: "TWO",
      comment: "The room was not clean.",
      createTime: "2026-08-01T10:00:00.000Z",
      updateTime: "2026-08-02T10:00:00.000Z",
    }
    const linked = {
      externalLocationId: seed.externalLocationId,
      locationId: seed.locationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      googleLocationName: external.googleLocationName,
      verified: true,
    }
    const ingest = () =>
      runtime.begin(async (sql) => {
        await sql`
          select set_config(
            'app.organisation_id',
            ${owner.organisationId},
            true
          )
        `
        return upsertGoogleReview(sql, owner.organisationId, linked, payload)
      })
    await ingest()

    const request = await createRequest(owner.cookie, "erasure", reviewerName)
    expect((await fulfil(owner.cookie, request.id)).status).toBe(200)

    // Google keeps serving the review; the reconcile tick would otherwise
    // write every field the erasure destroyed straight back.
    await ingest()

    const [review] = await admin<
      {
        reviewerDisplayName: string | null
        text: string | null
        photo: string | null
        rawPayload: unknown
      }[]
    >`
      select
        reviewer_display_name as "reviewerDisplayName",
        review_text as text,
        reviewer_profile_photo_url as photo,
        raw_payload as "rawPayload"
      from review
      where id = ${seed.reviewId}
    `
    expect(review).toEqual({
      reviewerDisplayName: "Removed reviewer",
      text: null,
      photo: null,
      rawPayload: null,
    })
  })

  it("withdraws a live reply from Google before completing the erasure", async () => {
    stub.reset()
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const seed = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      replyState: "APPROVED",
    })
    const reviewerName = `Published reviewer ${randomUUID()}`
    await admin`
      update review
      set reviewer_display_name = ${reviewerName}
      where id = ${seed.reviewId}
    `
    const request = await createRequest(owner.cookie, "erasure", reviewerName)

    const response = await fulfil(owner.cookie, request.id)
    expect(response.status).toBe(200)
    expect((await response.json()).request.status).toBe("completed")
    expect(
      stub.calls.some(
        (call) => call.method === "DELETE" && call.path.endsWith("/reply")
      )
    ).toBe(true)

    const [reply] = await admin<
      { publishStatus: string; currentBody: string | null }[]
    >`
      select publish_status as "publishStatus", current_body as "currentBody"
      from review_reply
      where review_id = ${seed.reviewId}
    `
    expect(reply).toEqual({ publishStatus: "deleted", currentBody: null })
    const [erased] = await admin<{ erasedAt: Date | null }[]>`
      select erased_at as "erasedAt" from review where id = ${seed.reviewId}
    `
    expect(erased.erasedAt).toBeInstanceOf(Date)
  })

  it("keeps the request open when Google will not withdraw the reply, and finishes it on retry", async () => {
    stub.reset()
    stub.respond({ method: "DELETE", pathEndsWith: "/reply" }, () => ({
      status: 500,
      json: { error: { status: "INTERNAL" } },
    }))
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const seed = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      replyState: "APPROVED",
    })
    const reviewerName = `Stuck reviewer ${randomUUID()}`
    await admin`
      update review
      set reviewer_display_name = ${reviewerName}
      where id = ${seed.reviewId}
    `
    const request = await createRequest(owner.cookie, "erasure", reviewerName)

    const response = await fulfil(owner.cookie, request.id)
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe("privacy_reply_withdraw_failed")

    // The request stays open and retryable; the local scrub is committed
    // regardless, so nothing keeps the name locally in the meantime.
    const [privacyRequest] = await admin<{ status: string }[]>`
      select status from privacy_request where id = ${request.id}
    `
    expect(privacyRequest.status).toBe("in_progress")
    const [review] = await admin<
      { reviewerDisplayName: string | null; erasedAt: Date | null }[]
    >`
      select
        reviewer_display_name as "reviewerDisplayName",
        erased_at as "erasedAt"
      from review
      where id = ${seed.reviewId}
    `
    expect(review.reviewerDisplayName).toBe("Removed reviewer")
    expect(review.erasedAt).toBeInstanceOf(Date)
    const [reply] = await admin<{ currentBody: string | null }[]>`
      select current_body as "currentBody"
      from review_reply
      where review_id = ${seed.reviewId}
    `
    expect(reply.currentBody).toBeNull()
    // The parked reviews are recorded on the request, because the retry can
    // no longer find them by subject reference: this erasure replaced the
    // display name it was logged against.
    const [parked] = await admin<{ pendingReviewIds: string[] }[]>`
      select pending_review_ids::text[] as "pendingReviewIds"
      from privacy_request
      where id = ${request.id}
    `
    expect(parked.pendingReviewIds).toEqual([seed.reviewId])

    // Google recovers; fulfilling again has to finish the withdrawal rather
    // than match nothing and report the erasure complete with the reply live.
    stub.reset()
    const retry = await fulfil(owner.cookie, request.id)
    expect(retry.status).toBe(200)
    expect((await retry.json()).request.status).toBe("completed")
    const [withdrawn] = await admin<{ publishStatus: string }[]>`
      select publish_status as "publishStatus"
      from review_reply
      where review_id = ${seed.reviewId}
    `
    expect(withdrawn.publishStatus).toBe("deleted")
    const [settled] = await admin<
      { status: string; pendingReviewIds: string[] }[]
    >`
      select status, pending_review_ids::text[] as "pendingReviewIds"
      from privacy_request
      where id = ${request.id}
    `
    expect(settled).toEqual({ status: "completed", pendingReviewIds: [] })
    stub.reset()
  })

  // ---------------------------------------------------------------------
  // Background-resumable withdrawals (plan P04-5)
  // ---------------------------------------------------------------------

  /** One job tick; the privacy runner shares it (lib/server/jobs.ts). */
  async function runJobsTick(baseUrl = server.baseUrl) {
    const response = await fetch(`${baseUrl}/api/jobs/run`, {
      method: "POST",
      headers: { authorization: "Bearer route-harness-cron-secret" },
    })
    expect(response.status, await response.clone().text()).toBe(200)
    return (await response.json()) as {
      privacy?: Record<string, number>
    }
  }

  type RetryState = {
    status: string
    withdrawalAttempts: number
    nextAttemptAt: Date | null
    lastErrorCode: string | null
    pendingReviewIds: string[]
    resolvedBy: string | null
  }

  async function retryState(id: string): Promise<RetryState> {
    const [row] = await admin<RetryState[]>`
      select
        status,
        withdrawal_attempts as "withdrawalAttempts",
        next_attempt_at as "nextAttemptAt",
        last_error_code as "lastErrorCode",
        pending_review_ids::text[] as "pendingReviewIds",
        resolved_by::text as "resolvedBy"
      from privacy_request
      where id = ${id}
    `
    return row
  }

  /** Make a parked request due now, as if its backoff had elapsed. */
  async function makeDue(id: string) {
    await admin`
      update privacy_request
      set next_attempt_at = now() - interval '1 second',
          withdrawal_lease_expires_at = null
      where id = ${id}
    `
  }

  /** An erasure whose live reply Google refuses to drop with `status`. */
  async function parkedErasure(failStatus: number, label: string) {
    stub.reset()
    stub.respond({ method: "DELETE", pathEndsWith: "/reply" }, () => ({
      status: failStatus,
      json: {
        error: {
          status: failStatus === 403 ? "PERMISSION_DENIED" : "INTERNAL",
        },
      },
    }))
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const seed = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      replyState: "APPROVED",
    })
    const reviewerName = `${label} reviewer ${randomUUID()}`
    await admin`
      update review
      set reviewer_display_name = ${reviewerName}
      where id = ${seed.reviewId}
    `
    const request = await createRequest(owner.cookie, "erasure", reviewerName)
    const response = await fulfil(owner.cookie, request.id)
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).toBe("privacy_reply_withdraw_failed")
    return { owner, seed, request }
  }

  it("refuses to close a parked erasure by status while replies are still live", async () => {
    const { owner, request } = await parkedErasure(500, "Unclosable")

    for (const status of ["rejected", "completed"] as const) {
      const response = await changeStatus(owner.cookie, request.id, status)
      expect(response.status).toBe(409)
      expect((await response.json()).error).toBe("privacy_withdrawal_pending")
    }
    // Still open, still parked, so the job tick keeps retrying it.
    const parked = await retryState(request.id)
    expect(parked.status).toBe("in_progress")
    expect(parked.pendingReviewIds).toHaveLength(1)
    expect(parked.nextAttemptAt).toBeInstanceOf(Date)
    stub.reset()
  })

  it("retries a parked withdrawal on the job tick and completes it with an audit", async () => {
    const { owner, seed, request } = await parkedErasure(500, "Background")

    const parked = await retryState(request.id)
    expect(parked.status).toBe("in_progress")
    expect(parked.withdrawalAttempts).toBe(1)
    expect(parked.lastErrorCode).toBe("google_mutation_ambiguous")
    // Backoff: the next round is scheduled, not immediate.
    expect(parked.nextAttemptAt).toBeInstanceOf(Date)
    expect(parked.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now())

    // Not due yet: a tick leaves it alone.
    await runJobsTick()
    expect((await retryState(request.id)).status).toBe("in_progress")

    // Google recovers and the backoff elapses: the tick finishes the erasure
    // as the owner who fulfilled it, with no one re-fulfilling by hand.
    stub.reset()
    await makeDue(request.id)
    const tick = await runJobsTick()
    expect(tick.privacy?.claimed).toBeGreaterThanOrEqual(1)

    const settled = await retryState(request.id)
    expect(settled).toMatchObject({
      status: "completed",
      pendingReviewIds: [],
      nextAttemptAt: null,
      lastErrorCode: null,
      resolvedBy: owner.userId,
    })
    const [reply] = await admin<{ publishStatus: string }[]>`
      select publish_status as "publishStatus"
      from review_reply
      where review_id = ${seed.reviewId}
    `
    expect(reply.publishStatus).toBe("deleted")
    const audits = await admin<
      { action: string; metadata: { source?: string; pending?: unknown[] } }[]
    >`
      select action, metadata
      from audit_log
      where subject_id = ${request.id}
        and action = 'privacy.request.replies_withdrawn'
      order by created_at
    `
    expect(audits.map(({ metadata }) => metadata.source)).toEqual([
      "fulfil",
      "background",
    ])
    expect(audits[1]!.metadata.pending).toEqual([])
    stub.reset()
  })

  it("keeps a withdrawal pending, at no cost to its budget, while publishing is off", async () => {
    const paused = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      PUBLISH_ENABLED: "false",
    })
    try {
      stub.reset()
      const owner = await createTestTenant(admin)
      organisations.push(owner.organisationId)
      const connection = await seedGoogleConnection(admin, {
        organisationId: owner.organisationId,
      })
      const seed = await seedLinkedReview(admin, {
        organisationId: owner.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
        replyState: "APPROVED",
      })
      const reviewerName = `Paused reviewer ${randomUUID()}`
      await admin`
        update review
        set reviewer_display_name = ${reviewerName}
        where id = ${seed.reviewId}
      `
      const request = await createRequest(owner.cookie, "erasure", reviewerName)
      const response = await fulfil(
        owner.cookie,
        request.id,
        "Fulfilled.",
        paused.baseUrl
      )
      expect(response.status).toBe(409)
      expect((await retryState(request.id)).lastErrorCode).toBe(
        "publishing_paused"
      )

      await makeDue(request.id)
      await runJobsTick(paused.baseUrl)
      const state = await retryState(request.id)
      expect(state).toMatchObject({
        status: "in_progress",
        withdrawalAttempts: 0,
        lastErrorCode: "publishing_paused",
        pendingReviewIds: [seed.reviewId],
      })
      // Deferred, not abandoned: it comes round again.
      expect(state.nextAttemptAt).toBeInstanceOf(Date)
      expect(
        stub.calls.some(
          (call) => call.method === "DELETE" && call.path.endsWith("/reply")
        )
      ).toBe(false)
    } finally {
      await paused.stop()
    }
  })

  it("stops retrying as an owner who lost the owner role, and surfaces it", async () => {
    const { owner, request } = await parkedErasure(500, "Revoked")
    // An organisation keeps at least one owner, so another takes over before
    // the fulfilling owner is demoted.
    const successor = randomUUID()
    await admin`
      insert into app_user (id, email, display_name, default_organisation_id)
      values (
        ${successor},
        ${`successor-${successor.slice(0, 8)}@nabapresence.test`},
        'Successor owner',
        ${owner.organisationId}
      )
    `
    await admin`
      insert into member (organisation_id, user_id, role, can_publish)
      values (${owner.organisationId}, ${successor}, 'owner', true)
    `
    await admin`
      update member
      set role = 'admin'
      where organisation_id = ${owner.organisationId}
        and user_id = ${owner.userId}
    `
    stub.reset()
    await makeDue(request.id)
    await runJobsTick()

    const state = await retryState(request.id)
    expect(state).toMatchObject({
      status: "in_progress",
      lastErrorCode: "actor_revoked",
      nextAttemptAt: null,
      withdrawalAttempts: 1,
    })
    expect(
      stub.calls.some(
        (call) => call.method === "DELETE" && call.path.endsWith("/reply")
      )
    ).toBe(false)
    const [held] = await admin<{ metadata: { reason: string } }[]>`
      select metadata
      from audit_log
      where subject_id = ${request.id}
        and action = 'privacy.request.withdrawal_held'
    `
    expect(held.metadata.reason).toBe("role_changed")

    // The console (admins can read it) shows it as needing a person.
    const listed = await fetch(`${server.baseUrl}/api/privacy/requests`, {
      headers: { cookie: owner.cookie },
    })
    expect(listed.status).toBe(200)
    const { requests } = (await listed.json()) as {
      requests: {
        id: string
        overdue: boolean
        withdrawalStalled: boolean
        lastErrorCode: string | null
      }[]
    }
    expect(requests[0]).toMatchObject({
      id: request.id,
      overdue: true,
      withdrawalStalled: true,
      lastErrorCode: "actor_revoked",
    })
  })

  it("surfaces a withdrawal as overdue once its retry budget is spent", async () => {
    const { owner, request } = await parkedErasure(403, "Exhausted")
    await admin`
      update privacy_request
      set withdrawal_attempts = 11
      where id = ${request.id}
    `
    await makeDue(request.id)
    await runJobsTick()

    const state = await retryState(request.id)
    expect(state).toMatchObject({
      status: "in_progress",
      withdrawalAttempts: 12,
      nextAttemptAt: null,
    })
    expect(state.lastErrorCode).not.toBeNull()
    const [exhausted] = await admin<{ action: string }[]>`
      select action
      from audit_log
      where subject_id = ${request.id}
        and action = 'privacy.request.withdrawal_exhausted'
    `
    expect(exhausted).toBeDefined()

    // Exhausted rows are not claimed again.
    const before = await retryState(request.id)
    await runJobsTick()
    expect(await retryState(request.id)).toEqual(before)

    const listed = await fetch(`${server.baseUrl}/api/privacy/requests`, {
      headers: { cookie: owner.cookie },
    })
    const { requests } = (await listed.json()) as {
      requests: { id: string; overdue: boolean; withdrawalStalled: boolean }[]
    }
    expect(requests[0]).toMatchObject({
      id: request.id,
      overdue: true,
      withdrawalStalled: true,
    })
    stub.reset()
  })

  it("holds a parked withdrawal when a legal hold lands, without calling Google", async () => {
    const { owner, seed, request } = await parkedErasure(500, "Held")
    await admin`
      insert into legal_hold (organisation_id, review_id, reason, approved_by)
      values (
        ${owner.organisationId},
        ${seed.reviewId},
        'Dispute after erasure',
        ${owner.userId}
      )
    `
    stub.reset()
    await makeDue(request.id)
    await runJobsTick()

    expect(await retryState(request.id)).toMatchObject({
      status: "in_progress",
      lastErrorCode: "privacy_legal_hold",
      nextAttemptAt: null,
      // A hold is a human decision, not a failed round.
      withdrawalAttempts: 1,
      pendingReviewIds: [seed.reviewId],
    })
    expect(
      stub.calls.some(
        (call) => call.method === "DELETE" && call.path.endsWith("/reply")
      )
    ).toBe(false)
    const [held] = await admin<{ metadata: { code: string } }[]>`
      select metadata
      from audit_log
      where subject_id = ${request.id}
        and action = 'privacy.request.withdrawal_held'
    `
    expect(held.metadata.code).toBe("privacy_legal_hold")
  })

  it("restarts the budget and takes over as actor when an owner re-fulfils an exhausted withdrawal", async () => {
    const { owner, request } = await parkedErasure(403, "Takeover")
    await admin`
      update privacy_request
      set withdrawal_attempts = 11
      where id = ${request.id}
    `
    await makeDue(request.id)
    await runJobsTick()
    expect(await retryState(request.id)).toMatchObject({
      withdrawalAttempts: 12,
      nextAttemptAt: null,
    })

    // Another owner picks it up while Google still refuses.
    const successor = await createActor(owner.organisationId, "owner")
    const retry = await fulfil(successor.cookie, request.id)
    expect(retry.status).toBe(409)
    expect((await retry.json()).error).toBe("privacy_reply_withdraw_failed")

    const state = await retryState(request.id)
    expect(state.status).toBe("in_progress")
    // Reset to zero by the re-fulfil, then its own inline round.
    expect(state.withdrawalAttempts).toBe(1)
    expect(state.nextAttemptAt).toBeInstanceOf(Date)
    const [actor] = await admin<{ actorUserId: string | null }[]>`
      select withdrawal_actor_id::text as "actorUserId"
      from privacy_request
      where id = ${request.id}
    `
    expect(actor.actorUserId).toBe(successor.userId)
    stub.reset()
  })

  it("completes a parked withdrawal whose reply was deleted out of band, without calling Google", async () => {
    const { owner, seed, request } = await parkedErasure(500, "Out of band")
    await admin`
      update review_reply
      set publish_status = 'deleted'
      where review_id = ${seed.reviewId}
    `
    stub.reset()
    await makeDue(request.id)
    await runJobsTick()

    expect(await retryState(request.id)).toMatchObject({
      status: "completed",
      pendingReviewIds: [],
      nextAttemptAt: null,
      resolvedBy: owner.userId,
    })
    expect(
      stub.calls.some(
        (call) => call.method === "DELETE" && call.path.endsWith("/reply")
      )
    ).toBe(false)
  })

  it("will not fulfil a rejected request, nor reopen a completed one", async () => {
    const fixture = await createFixture()
    const rejected = await createRequest(
      fixture.owner.cookie,
      "erasure",
      fixture.reviewerName
    )
    expect(
      (await changeStatus(fixture.owner.cookie, rejected.id, "rejected")).status
    ).toBe(200)

    // The race the lock exists for: a fulfil landing behind a reject must not
    // destroy the data and record the request as completed.
    const late = await fulfil(fixture.owner.cookie, rejected.id)
    expect(late.status).toBe(409)
    expect((await late.json()).error).toBe("privacy_request_resolved")
    const [review] = await admin<
      { reviewerDisplayName: string | null; erasedAt: Date | null }[]
    >`
      select
        reviewer_display_name as "reviewerDisplayName",
        erased_at as "erasedAt"
      from review
      where id = ${fixture.review.reviewId}
    `
    expect(review).toEqual({
      reviewerDisplayName: fixture.reviewerName,
      erasedAt: null,
    })

    // And the mirror: a completed request cannot be recorded as rejected.
    const completed = await createRequest(
      fixture.owner.cookie,
      "access",
      fixture.reviewerName
    )
    expect((await fulfil(fixture.owner.cookie, completed.id)).status).toBe(200)
    const overwrite = await changeStatus(
      fixture.owner.cookie,
      completed.id,
      "rejected"
    )
    expect(overwrite.status).toBe(409)
    expect((await overwrite.json()).error).toBe("privacy_request_resolved")
    const [stored] = await admin<{ status: string }[]>`
      select status from privacy_request where id = ${completed.id}
    `
    expect(stored.status).toBe("completed")
  })

  it("refuses a backwards status move, in the route and in the trigger", async () => {
    const fixture = await createFixture()
    const request = await createRequest(
      fixture.owner.cookie,
      "access",
      fixture.reviewerName
    )
    expect(
      (await changeStatus(fixture.owner.cookie, request.id, "in_progress"))
        .status
    ).toBe(200)
    const backwards = await changeStatus(
      fixture.owner.cookie,
      request.id,
      "pending"
    )
    expect(backwards.status).toBe(409)
    expect((await backwards.json()).error).toBe(
      "privacy_request_transition_invalid"
    )

    // The route guard is not the only line of defence: the trigger refuses a
    // caller that bypasses it entirely.
    expect((await fulfil(fixture.owner.cookie, request.id)).status).toBe(200)
    await expect(
      admin`
        update privacy_request
        set status = 'pending'
        where id = ${request.id}
      `
    ).rejects.toThrow(/invalid privacy request transition/)
  })

  it("dates the statutory deadline and lists the overdue request first", async () => {
    const fixture = await createFixture()
    const fresh = await createRequest(
      fixture.owner.cookie,
      "access",
      fixture.reviewerName
    )
    // The deadline is stored when the request is logged, not derived at read
    // time, so it survives a later change to the response window.
    const window =
      new Date(fresh.dueAt).getTime() - new Date(fresh.createdAt).getTime()
    expect(window).toBeGreaterThan(29 * DAY_MS)
    expect(window).toBeLessThan(31 * DAY_MS)

    const breached = await createRequest(
      fixture.owner.cookie,
      "rectification",
      fixture.reviewerName
    )
    await admin`
      update privacy_request
      set due_at = now() - interval '2 days'
      where id = ${breached.id}
    `
    const resolved = await createRequest(
      fixture.owner.cookie,
      "access",
      fixture.reviewerName
    )
    await admin`
      update privacy_request
      set due_at = now() - interval '5 days'
      where id = ${resolved.id}
    `
    expect((await fulfil(fixture.owner.cookie, resolved.id)).status).toBe(200)

    const response = await fetch(`${server.baseUrl}/api/privacy/requests`, {
      headers: { cookie: fixture.owner.cookie },
    })
    expect(response.status).toBe(200)
    const { requests } = (await response.json()) as {
      requests: { id: string; overdue: boolean }[]
    }
    // Open requests first, the closest to its deadline at the top; a
    // resolved request is never overdue, however long it sat.
    expect(requests.map((row) => row.id)).toEqual([
      breached.id,
      fresh.id,
      resolved.id,
    ])
    expect(requests.map((row) => row.overdue)).toEqual([true, false, false])
  })

  async function exportPage(
    cookie: string,
    body: { subject: string; cursor?: string; pageSize?: number }
  ) {
    return fetch(`${server.baseUrl}/api/privacy/export`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  async function exportAudits(organisationId: string) {
    return admin<
      {
        metadata: {
          page?: number
          records?: number
          totalMatched?: number
          truncated?: boolean
          complete?: boolean
        }
      }[]
    >`
      select metadata
      from audit_log
      where organisation_id = ${organisationId}
        and action = 'privacy.data.exported'
      order by created_at, id
    `
  }

  it("reports the true match count and completion on a single-page export", async () => {
    const fixture = await createFixture()
    const second = await seedReview(admin, {
      organisationId: fixture.owner.organisationId,
    })
    await admin`
      update review
      set reviewer_display_name = ${fixture.reviewerName}
      where id = ${second.reviewId}
    `

    const response = await exportPage(fixture.owner.cookie, {
      subject: fixture.reviewerName,
    })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.totalMatched).toBe(2)
    expect(payload.returned).toBe(2)
    expect(payload.page).toBe(1)
    expect(payload.truncated).toBe(false)
    expect(payload.nextCursor).toBeNull()
    expect(payload.complete).toBe(true)
    expect(payload.addedDuringExport).toBe(0)
    expect(payload.reviews).toHaveLength(2)
    // No row carries the keyset position or a window count out with it.
    expect(payload.reviews[0].totalMatched).toBeUndefined()
    expect(payload.reviews[0].cursorCreateTime).toBeUndefined()

    const audits = await exportAudits(fixture.owner.organisationId)
    expect(audits).toHaveLength(1)
    expect(audits[0].metadata).toMatchObject({
      page: 1,
      records: 2,
      totalMatched: 2,
      truncated: false,
      complete: true,
    })
  })

  it("exports 1200 matches across keyset pages with no gaps or duplicates and resumes from a cursor", async () => {
    const fixture = await createFixture()
    // 1199 copies of the fixture review. Every third one shares a create
    // time with its neighbours (the id breaks the tie) and the rest differ
    // only by microseconds, which a millisecond cursor would skip or repeat.
    await admin`
      insert into review (
        id, organisation_id, location_id, external_location_id,
        google_review_name_ciphertext, google_review_name_hash,
        google_review_id_ciphertext, google_review_id_hash,
        reviewer_display_name, reviewer_is_anonymous, star_rating, review_text,
        detected_language_code, language_confidence, has_media,
        create_time, update_time, content_hash, workflow_status, raw_payload
      )
      select
        gen_random_uuid(), r.organisation_id, r.location_id,
        r.external_location_id,
        r.google_review_name_ciphertext,
        encode(sha256(convert_to('bulk-name-' || g || '-' || r.id, 'UTF8')), 'hex'),
        r.google_review_id_ciphertext,
        encode(sha256(convert_to('bulk-id-' || g || '-' || r.id, 'UTF8')), 'hex'),
        r.reviewer_display_name, r.reviewer_is_anonymous, r.star_rating,
        r.review_text, r.detected_language_code, r.language_confidence,
        r.has_media,
        timestamptz '2026-09-01T12:00:00.000000Z'
          - (g / 3) * interval '1 microsecond',
        r.update_time,
        r.content_hash, r.workflow_status, r.raw_payload
      from review r
      cross join generate_series(1, 1199) as g
      where r.id = ${fixture.review.reviewId}
    `
    // Another reviewer's review never leaks into the subject's pages.
    await seedReview(admin, { organisationId: fixture.owner.organisationId })
    const [{ expected }] = await admin<{ expected: number }[]>`
      select count(*)::int as expected
      from review
      where organisation_id = ${fixture.owner.organisationId}
        and reviewer_display_name = ${fixture.reviewerName}
    `
    expect(expected).toBe(1200)

    // The first page and the second are fetched; then the download is
    // "interrupted" and resumed from the second page's cursor.
    const ids: string[] = []
    const pages: { page: number; returned: number; total: number }[] = []
    let cursor: string | undefined
    let resumeFrom: string | undefined
    for (let guard = 0; guard < 10; guard++) {
      const response = await exportPage(fixture.owner.cookie, {
        subject: fixture.reviewerName,
        pageSize: 500,
        ...(cursor ? { cursor } : {}),
      })
      expect(response.status).toBe(200)
      const payload = (await response.json()) as {
        page: number
        returned: number
        totalMatched: number
        truncated: boolean
        nextCursor: string | null
        reviews: { id: string; googleReviewId: string }[]
      }
      expect(payload.truncated).toBe(payload.nextCursor !== null)
      pages.push({
        page: payload.page,
        returned: payload.returned,
        total: payload.totalMatched,
      })
      ids.push(...payload.reviews.map((review) => review.id))
      if (payload.page === 2) resumeFrom = payload.nextCursor ?? undefined
      if (!payload.nextCursor) break
      cursor = payload.nextCursor
    }
    expect(pages).toEqual([
      { page: 1, returned: 500, total: 1200 },
      { page: 2, returned: 500, total: 1200 },
      { page: 3, returned: 200, total: 1200 },
    ])
    expect(ids).toHaveLength(1200)
    expect(new Set(ids).size).toBe(1200)

    // Resuming from the cursor returns exactly the third page again.
    const resumed = await exportPage(fixture.owner.cookie, {
      subject: fixture.reviewerName,
      pageSize: 500,
      cursor: resumeFrom,
    })
    expect(resumed.status).toBe(200)
    const resumedPayload = (await resumed.json()) as {
      page: number
      nextCursor: string | null
      reviews: { id: string }[]
    }
    expect(resumedPayload.page).toBe(3)
    expect(resumedPayload.nextCursor).toBeNull()
    expect(resumedPayload.reviews.map((review) => review.id)).toEqual(
      ids.slice(1000)
    )
    expect(resumed.headers.get("content-disposition")).toContain(
      "privacy-export-page-3.json"
    )

    // One audit row per page served, each naming its page.
    const audits = await exportAudits(fixture.owner.organisationId)
    expect(audits.map((row) => row.metadata.page)).toEqual([1, 2, 3, 3])
    expect(audits.map((row) => row.metadata.records)).toEqual([
      500, 500, 200, 200,
    ])
    expect(audits.map((row) => row.metadata.complete)).toEqual([
      false,
      false,
      true,
      true,
    ])
    expect(audits.every((row) => row.metadata.totalMatched === 1200)).toBe(true)
  })

  it("rejects a malformed cursor and one minted for another subject", async () => {
    const fixture = await createFixture()
    const second = await seedReview(admin, {
      organisationId: fixture.owner.organisationId,
    })
    await admin`
      update review
      set reviewer_display_name = ${fixture.reviewerName}
      where id = ${second.reviewId}
    `
    const first = await exportPage(fixture.owner.cookie, {
      subject: fixture.reviewerName,
      pageSize: 1,
    })
    expect(first.status).toBe(200)
    const { nextCursor } = (await first.json()) as { nextCursor: string }
    expect(nextCursor).toEqual(expect.any(String))

    const garbled = await exportPage(fixture.owner.cookie, {
      subject: fixture.reviewerName,
      cursor: "not-a-cursor",
    })
    expect(garbled.status).toBe(400)
    expect((await garbled.json()).error).toBe("invalid_cursor")

    const crossSubject = await exportPage(fixture.owner.cookie, {
      subject: "Somebody else entirely",
      cursor: nextCursor,
    })
    expect(crossSubject.status).toBe(400)
    expect((await crossSubject.json()).error).toBe("invalid_cursor")

    // The cursor names nothing about the subject, and its page index and
    // position cannot be edited under the MAC.
    const separator = nextCursor.lastIndexOf(".")
    const payload = JSON.parse(
      Buffer.from(nextCursor.slice(0, separator), "base64url").toString()
    ) as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual([
      "createTime",
      "id",
      "page",
      "startedAt",
      "v",
    ])
    const forged = `${Buffer.from(
      JSON.stringify({ ...payload, page: 9 })
    ).toString("base64url")}${nextCursor.slice(separator)}`
    const forgedResponse = await exportPage(fixture.owner.cookie, {
      subject: fixture.reviewerName,
      cursor: forged,
    })
    expect(forgedResponse.status).toBe(400)
    expect((await forgedResponse.json()).error).toBe("invalid_cursor")

    const oversized = await exportPage(fixture.owner.cookie, {
      subject: fixture.reviewerName,
      pageSize: 1001,
    })
    expect(oversized.status).toBe(400)
  })

  /** Seeds one more review for the fixture subject at each create time. */
  async function seedSubjectReviews(
    fixture: Awaited<ReturnType<typeof createFixture>>,
    createTimes: string[]
  ) {
    const ids: string[] = []
    for (const createTime of createTimes) {
      const seeded = await seedReview(admin, {
        organisationId: fixture.owner.organisationId,
      })
      await admin`
        update review
        set reviewer_display_name = ${fixture.reviewerName},
          create_time = ${createTime}::timestamptz
        where id = ${seeded.reviewId}
      `
      ids.push(seeded.reviewId)
    }
    return ids
  }

  type ExportPayload = {
    page: number
    complete: boolean
    addedDuringExport: number
    nextCursor: string | null
    reviews: { id: string }[]
  }

  it("still serves a review whose update time a sync bumps mid-export", async () => {
    const fixture = await createFixture()
    await admin`
      update review set create_time = '2026-01-01T00:00:00Z'
      where id = ${fixture.review.reviewId}
    `
    const [newest, middle] = await seedSubjectReviews(fixture, [
      "2026-03-01T00:00:00Z",
      "2026-02-01T00:00:00Z",
    ])

    const first = (await (
      await exportPage(fixture.owner.cookie, {
        subject: fixture.reviewerName,
        pageSize: 1,
      })
    ).json()) as ExportPayload
    expect(first.reviews.map((review) => review.id)).toEqual([newest])

    // The subject edits the oldest review upstream and a sync rewrites its
    // update time to now: newer than anything already served.
    await admin`
      update review set update_time = now()
      where id = ${fixture.review.reviewId}
    `

    const ids = [...first.reviews.map((review) => review.id)]
    let cursor = first.nextCursor
    let last = first
    while (cursor) {
      const response = await exportPage(fixture.owner.cookie, {
        subject: fixture.reviewerName,
        pageSize: 1,
        cursor,
      })
      expect(response.status).toBe(200)
      last = (await response.json()) as ExportPayload
      ids.push(...last.reviews.map((review) => review.id))
      cursor = last.nextCursor
    }
    expect(ids).toEqual([newest, middle, fixture.review.reviewId])
    expect(last.complete).toBe(true)
    expect(last.addedDuringExport).toBe(0)
  })

  it("reports an export incomplete when a matching review is first stored after page 1", async () => {
    const fixture = await createFixture()
    await admin`
      update review set create_time = '2026-01-01T00:00:00Z'
      where id = ${fixture.review.reviewId}
    `
    const [older] = await seedSubjectReviews(fixture, ["2026-02-01T00:00:00Z"])

    const first = (await (
      await exportPage(fixture.owner.cookie, {
        subject: fixture.reviewerName,
        pageSize: 1,
      })
    ).json()) as ExportPayload
    expect(first.reviews.map((review) => review.id)).toEqual([older])

    // A sync imports the subject's newest review, which sorts ahead of the
    // cursor into ground page 1 already covered.
    const [added] = await seedSubjectReviews(fixture, ["2026-04-01T00:00:00Z"])

    const second = await exportPage(fixture.owner.cookie, {
      subject: fixture.reviewerName,
      pageSize: 1,
      cursor: first.nextCursor ?? undefined,
    })
    expect(second.status).toBe(200)
    const payload = (await second.json()) as ExportPayload & {
      totalMatched: number
    }
    expect(payload.nextCursor).toBeNull()
    expect(payload.reviews.map((review) => review.id)).toEqual([
      fixture.review.reviewId,
    ])
    expect(payload.totalMatched).toBe(3)
    expect(payload.addedDuringExport).toBe(1)
    expect(payload.complete).toBe(false)

    const audits = await admin<
      {
        metadata: {
          page: number
          complete: boolean
          addedDuringExport: number
          after: { createTime: string; id: string } | null
        }
      }[]
    >`
      select metadata
      from audit_log
      where organisation_id = ${fixture.owner.organisationId}
        and action = 'privacy.data.exported'
      order by created_at, id
    `
    expect(audits.map((row) => row.metadata)).toMatchObject([
      { page: 1, complete: false, addedDuringExport: 0, after: null },
      {
        page: 2,
        complete: false,
        addedDuringExport: 1,
        after: { createTime: "2026-02-01T00:00:00.000000Z", id: older },
      },
    ])

    // Restarting from page 1 carries the added review.
    const restarted = (await (
      await exportPage(fixture.owner.cookie, { subject: fixture.reviewerName })
    ).json()) as ExportPayload
    expect(restarted.reviews.map((review) => review.id)).toEqual([
      added,
      older,
      fixture.review.reviewId,
    ])
    expect(restarted.complete).toBe(true)
  })
})
