import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  saveHumanDraft,
  seedGoogleConnection,
  seedLinkedReview,
  seedMemberUser,
  seedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("bulk review actions", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  let stub: GoogleStub
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: stub.baseUrl })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function fixture() {
    const tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    return tenant
  }

  const post = (cookie: string, body: unknown) =>
    fetch(`${server.baseUrl}/api/reviews/bulk`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    })

  /**
   * A reply parked for approval by a member who cannot publish, as the
   * owner's inbox would list it: the draft on screen and the review's
   * update time when it was shown.
   */
  async function awaitingApproval(
    owner?: Awaited<ReturnType<typeof fixture>>,
    options: { draftedByOwner?: boolean } = {}
  ) {
    const tenant = owner ?? (await fixture())
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const review = await seedLinkedReview(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const requester = await seedMemberUser(admin, {
      organisationId: tenant.organisationId,
      role: "member",
      canPublish: false,
    })
    const draft = await saveHumanDraft(
      server.baseUrl,
      options.draftedByOwner ? tenant.cookie : requester.cookie,
      review.reviewId,
      "Thank you for sharing your experience."
    )
    const requested = await fetch(
      `${server.baseUrl}/api/reviews/${review.reviewId}/publish`,
      {
        method: "POST",
        headers: { cookie: requester.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          draftId: draft.draftId,
          expectedReviewUpdateTime: draft.expectedReviewUpdateTime,
        }),
      }
    )
    expect(requested.status, await requested.clone().text()).toBe(202)
    return {
      owner: tenant,
      reviewId: review.reviewId,
      shown: {
        reviewId: review.reviewId,
        draftId: draft.draftId,
        reviewUpdateTime: draft.expectedReviewUpdateTime,
      },
    }
  }

  const decisions = async (reviewId: string) =>
    (
      await admin<{ count: number }[]>`
        select count(*)::int as count from approval_decision where review_id = ${reviewId}
      `
    )[0]!.count

  const puts = () => stub.calls.filter((call) => call.method === "PUT").length

  it("approves and publishes the draft the operator was shown", async () => {
    stub.reset()
    const parked = await awaitingApproval()
    const response = await post(parked.owner.cookie, {
      action: "approve",
      approvals: [parked.shown],
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      results: [{ reviewId: parked.reviewId, status: "ok" }],
    })
    expect(puts()).toBe(1)
  })

  it("refuses an approval of a draft other than the one parked", async () => {
    stub.reset()
    const parked = await awaitingApproval()
    const response = await post(parked.owner.cookie, {
      action: "approve",
      approvals: [{ ...parked.shown, draftId: randomUUID() }],
    })
    expect(await response.json()).toEqual({
      results: [
        { reviewId: parked.reviewId, status: "skipped", code: "approval_draft_changed" },
      ],
    })
    // Refused before anything was recorded or sent.
    expect(await decisions(parked.reviewId)).toBe(0)
    expect(puts()).toBe(0)
  })

  it("refuses an approval when the review changed after it was shown", async () => {
    stub.reset()
    const parked = await awaitingApproval()
    await admin`
      update review set update_time = update_time + interval '1 minute'
      where id = ${parked.reviewId}
    `
    const response = await post(parked.owner.cookie, {
      action: "approve",
      approvals: [parked.shown],
    })
    expect(await response.json()).toEqual({
      results: [{ reviewId: parked.reviewId, status: "skipped", code: "review_changed" }],
    })
    expect(await decisions(parked.reviewId)).toBe(0)
    expect(puts()).toBe(0)
  })

  it("reports a rate-limited publish after approval as approved, not skipped", async () => {
    stub.reset()
    const parked = await awaitingApproval()
    stub.respond({ method: "PUT", pathIncludes: "/reply" }, () => ({
      status: 429,
      json: { error: { status: "RESOURCE_EXHAUSTED", message: "slow down" } },
    }))
    const response = await post(parked.owner.cookie, {
      action: "approve",
      approvals: [parked.shown],
    })
    const body = (await response.json()) as {
      results: { reviewId: string; status: string; code?: string }[]
    }
    // Approved, and parked for the retry runner: re-approving would only
    // earn approval_not_pending, so the row must not invite a retry.
    expect(body.results).toEqual([
      {
        reviewId: parked.reviewId,
        status: "approved_not_published",
        code: "publish_retry_scheduled",
      },
    ])
    // The decision committed; "skipped" would have said nothing happened.
    expect(await decisions(parked.reviewId)).toBe(1)
    const [attempt] = await admin<{ status: string }[]>`
      select pa.status
      from publish_attempt pa
      join review_reply rr on rr.id = pa.review_reply_id
      where rr.review_id = ${parked.reviewId}
    `
    expect(attempt?.status).toBe("retryable")
  })

  it("does not count a reply Google answered with REJECTED as done", async () => {
    stub.reset()
    const parked = await awaitingApproval()
    stub.respond({ method: "PUT", pathIncludes: "/reply" }, () => ({
      status: 200,
      json: {
        comment: "Thank you for sharing your experience.",
        updateTime: "2026-08-20T10:00:00.000Z",
        state: "REJECTED",
        policyViolation: "SPAM",
      },
    }))
    const response = await post(parked.owner.cookie, {
      action: "approve",
      approvals: [parked.shown],
    })
    expect(await response.json()).toEqual({
      results: [
        {
          reviewId: parked.reviewId,
          status: "approved_not_published",
          code: "google_reply_rejected",
        },
      ],
    })
    expect(await decisions(parked.reviewId)).toBe(1)
  })

  it("reports an ambiguous publish after approval as uncertain", async () => {
    stub.reset()
    const parked = await awaitingApproval()
    stub.respond({ method: "PUT", pathIncludes: "/reply" }, () => ({
      status: 500,
      json: { error: { status: "INTERNAL", message: "unknown" } },
    }))
    const response = await post(parked.owner.cookie, {
      action: "approve",
      approvals: [parked.shown],
    })
    expect(await response.json()).toEqual({
      results: [
        { reviewId: parked.reviewId, status: "uncertain", code: "google_mutation_ambiguous" },
      ],
    })
    expect(await decisions(parked.reviewId)).toBe(1)
  })

  it("keeps every row's outcome in a mixed approve batch", async () => {
    stub.reset()
    const good = await awaitingApproval()
    const stale = await awaitingApproval(good.owner)
    const missing = randomUUID()
    const response = await post(good.owner.cookie, {
      action: "approve",
      approvals: [
        { ...stale.shown, draftId: randomUUID() },
        { ...good.shown, reviewId: missing },
        good.shown,
      ],
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      results: [
        { reviewId: stale.reviewId, status: "skipped", code: "approval_draft_changed" },
        { reviewId: missing, status: "skipped", code: "review_not_found" },
        { reviewId: good.reviewId, status: "ok" },
      ],
    })
  })

  // Two-person means the approver is neither the requester nor the draft's
  // author, on the bulk path as on the single approval route.
  it("skips a row whose draft the approver wrote in two-person mode", async () => {
    stub.reset()
    const owner = await fixture()
    const parked = await awaitingApproval(owner, { draftedByOwner: true })
    await admin`
      update organisation set require_two_person_approval = true
      where id = ${owner.organisationId}
    `
    const response = await post(owner.cookie, {
      action: "approve",
      approvals: [parked.shown],
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      results: [
        {
          reviewId: parked.reviewId,
          status: "skipped",
          code: "second_approver_required",
        },
      ],
    })
    expect(await decisions(parked.reviewId)).toBe(0)
    expect(puts()).toBe(0)
  })

  it("refuses the old id-only approve shape", async () => {
    const parked = await awaitingApproval()
    const response = await post(parked.owner.cookie, {
      action: "approve",
      reviewIds: [parked.reviewId],
    })
    expect(response.status).toBe(400)
    expect(await decisions(parked.reviewId)).toBe(0)
  })

  it("marks reviews as needing nothing, clearing them from Needs reply", async () => {
    const owner = await fixture()
    const first = await seedReview(admin, {
      organisationId: owner.organisationId,
      rating: 5,
    })
    const second = await seedReview(admin, {
      organisationId: owner.organisationId,
      rating: 5,
    })

    const before = await fetch(`${server.baseUrl}/api/reviews/counts`, {
      headers: { cookie: owner.cookie },
    })
    expect(((await before.json()) as { byQueue: Record<string, number> }).byQueue.needs_reply).toBe(2)

    const response = await post(owner.cookie, {
      action: "mark_reviewed",
      reviewIds: [first.reviewId, second.reviewId],
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      results: { reviewId: string; status: string }[]
    }
    expect(body.results.every((row) => row.status === "ok")).toBe(true)

    const after = await fetch(`${server.baseUrl}/api/reviews/counts`, {
      headers: { cookie: owner.cookie },
    })
    const counts = (await after.json()) as { byQueue: Record<string, number> }
    // Triaged rows leave Needs reply for Done without anything being
    // published — the whole point of the action.
    expect(counts.byQueue.needs_reply).toBe(0)
    expect(counts.byQueue.done).toBe(2)
  })

  it("assigns and unassigns", async () => {
    const owner = await fixture()
    const seeded = await seedReview(admin, { organisationId: owner.organisationId })

    await post(owner.cookie, {
      action: "assign",
      reviewIds: [seeded.reviewId],
      assigneeId: owner.userId,
    })
    const [assigned] = await admin<{ assignedTo: string | null }[]>`
      select assigned_to::text as "assignedTo" from review where id = ${seeded.reviewId}
    `
    expect(assigned?.assignedTo).toBe(owner.userId)

    await post(owner.cookie, {
      action: "assign",
      reviewIds: [seeded.reviewId],
      assigneeId: null,
    })
    const [cleared] = await admin<{ assignedTo: string | null }[]>`
      select assigned_to::text as "assignedTo" from review where id = ${seeded.reviewId}
    `
    expect(cleared?.assignedTo).toBeNull()
  })

  it("refuses an assignee who could not work on the review", async () => {
    // The foreign key only proves the id is some app_user. A viewer, a member
    // assigned elsewhere, or someone in another organisation would be handed
    // a review they cannot open or answer.
    const owner = await fixture()
    const other = await fixture()
    const seeded = await seedReview(admin, { organisationId: owner.organisationId })
    const elsewhere = await seedReview(admin, { organisationId: owner.organisationId })
    const viewer = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      role: "viewer",
    })
    const scopedAway = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      role: "member",
      assignLocationId: elsewhere.locationId,
    })

    for (const assigneeId of [viewer.userId, scopedAway.userId, other.userId]) {
      const response = await post(owner.cookie, {
        action: "assign",
        reviewIds: [seeded.reviewId],
        assigneeId,
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        results: [
          {
            reviewId: seeded.reviewId,
            status: "skipped",
            code: "assignee_not_eligible",
          },
        ],
      })
    }
    const [row] = await admin<{ assignedTo: string | null }[]>`
      select assigned_to::text as "assignedTo" from review where id = ${seeded.reviewId}
    `
    expect(row?.assignedTo).toBeNull()

    // The member assigned to the other location is eligible there.
    const ok = await post(owner.cookie, {
      action: "assign",
      reviewIds: [elsewhere.reviewId],
      assigneeId: scopedAway.userId,
    })
    expect(((await ok.json()) as { results: { status: string }[] }).results).toEqual([
      { reviewId: elsewhere.reviewId, status: "ok" },
    ])
  })

  it("skips rows outside a scoped member's locations", async () => {
    const owner = await fixture()
    const mine = await seedReview(admin, { organisationId: owner.organisationId })
    const hidden = await seedReview(admin, { organisationId: owner.organisationId })
    const member = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      role: "member",
      assignLocationId: mine.locationId,
    })
    const response = await post(member.cookie, {
      action: "mark_reviewed",
      reviewIds: [mine.reviewId, hidden.reviewId],
    })
    expect(((await response.json()) as { results: unknown[] }).results).toEqual([
      { reviewId: mine.reviewId, status: "ok" },
      { reviewId: hidden.reviewId, status: "skipped", code: "review_not_found" },
    ])
  })

  it("refuses a viewer outright", async () => {
    const owner = await fixture()
    const seeded = await seedReview(admin, { organisationId: owner.organisationId })
    const viewer = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      role: "viewer",
    })
    const response = await post(viewer.cookie, {
      action: "mark_reviewed",
      reviewIds: [seeded.reviewId],
    })
    expect(response.status).toBe(403)
  })

  it("skips an ineligible row rather than failing the batch", async () => {
    // Reviews move underneath an operator constantly; one stale row must not
    // discard the rest of the decisions.
    const owner = await fixture()
    const good = await seedReview(admin, { organisationId: owner.organisationId })
    const missing = randomUUID()

    const response = await post(owner.cookie, {
      action: "mark_reviewed",
      reviewIds: [good.reviewId, missing],
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      results: { reviewId: string; status: string; code?: string }[]
    }
    expect(body.results).toHaveLength(2)
    expect(body.results.find((row) => row.reviewId === good.reviewId)?.status).toBe("ok")
    const skipped = body.results.find((row) => row.reviewId === missing)
    expect(skipped?.status).toBe("skipped")
    expect(skipped?.code).toBe("review_not_found")
  })

  it("refuses an assign with no assignee named", async () => {
    const owner = await fixture()
    const seeded = await seedReview(admin, { organisationId: owner.organisationId })
    const response = await post(owner.cookie, {
      action: "assign",
      reviewIds: [seeded.reviewId],
    })
    expect(response.status).toBe(400)
  })

  it("caps the batch size", async () => {
    const owner = await fixture()
    const response = await post(owner.cookie, {
      action: "mark_reviewed",
      reviewIds: Array.from({ length: 101 }, () => randomUUID()),
    })
    expect(response.status).toBe(400)
  })
})
