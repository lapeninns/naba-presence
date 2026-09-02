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
    role: "admin" | "member" | "viewer"
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
      values (${organisationId}, ${userId}, ${role}, false)
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
      if (cursor) query.set("cursor", cursor)
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

  function fulfil(cookie: string, id: string, resolutionNote = "Fulfilled.") {
    return fetch(`${server.baseUrl}/api/privacy/requests`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        id,
        action: "fulfil",
        resolutionNote,
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
    const response = await fetch(`${server.baseUrl}/api/cron/retention`, {
      method: "POST",
      headers: {
        authorization: "Bearer route-harness-cron-secret",
      },
    })
    expect(response.status).toBe(200)
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

  it("reports the true match count and truncation flag on the export", async () => {
    const fixture = await createFixture()
    const second = await seedReview(admin, {
      organisationId: fixture.owner.organisationId,
    })
    await admin`
      update review
      set reviewer_display_name = ${fixture.reviewerName}
      where id = ${second.reviewId}
    `

    const response = await fetch(`${server.baseUrl}/api/privacy/export`, {
      method: "POST",
      headers: {
        cookie: fixture.owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ subject: fixture.reviewerName }),
    })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.totalMatched).toBe(2)
    expect(payload.returned).toBe(2)
    expect(payload.truncated).toBe(false)
    expect(payload.reviews).toHaveLength(2)
    // No row carries the window count out with it.
    expect(payload.reviews[0].totalMatched).toBeUndefined()

    const [audit] = await admin<
      { metadata: { totalMatched?: number; truncated?: boolean } }[]
    >`
      select metadata
      from audit_log
      where organisation_id = ${fixture.owner.organisationId}
        and action = 'privacy.data.exported'
      order by created_at desc
      limit 1
    `
    expect(audit.metadata.totalMatched).toBe(2)
    expect(audit.metadata.truncated).toBe(false)
  })
})
