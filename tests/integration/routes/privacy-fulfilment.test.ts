import { randomBytes, randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { sha256 } from "@/lib/server/crypto"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("privacy fulfilment and audit retention", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
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
    server = await startAppServer()
  })

  afterAll(async () => {
    await server?.stop()
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
    return (await response.json()).request as { id: string }
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
    const [audit] = await admin<
      { metadata: { reviewsAffected?: number } }[]
    >`
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

    const exportResponse = await fetch(
      `${server.baseUrl}/api/privacy/export?subject=${encodeURIComponent(fixture.reviewerName)}`,
      { headers: { cookie: fixture.owner.cookie } }
    )
    expect(exportResponse.status).toBe(200)
    expect((await exportResponse.json()).reviews[0].restrictedAt).toEqual(
      expect.any(String)
    )
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
})
