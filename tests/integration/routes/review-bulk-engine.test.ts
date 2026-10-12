import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  bulkOperationResponseSchema,
  type BulkOperationView,
} from "@/lib/contracts/bulk-listings"
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
const CRON = { authorization: "Bearer route-harness-cron-secret" }
const BODY = "Thank you for sharing your experience."

/**
 * P09-R8 through the real routes and the real job tick: bulk approve and
 * template replies run on the bulk engine for organisations with bulk
 * changes on. Rows are checked (approvals recorded) when the batch starts,
 * the job runner sends each reply once through the single-reply pipeline,
 * the outcomes are read back from the batch after the request is gone, an
 * interrupted batch resumes, and an unresolved publish is recovered by the
 * reply pipeline rather than sent again.
 */
describeDatabase("bulk review work on the engine", { timeout: 60_000 }, () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

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
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })
  beforeEach(() => stub.reset())

  const tick = async () => {
    const response = await fetch(`${server.baseUrl}/api/jobs/run`, {
      method: "POST",
      headers: CRON,
    })
    expect(response.status, await response.clone().text()).toBe(200)
  }
  const puts = () =>
    stub.calls.filter(
      (call) => call.method === "PUT" && call.path.endsWith("/reply")
    )

  async function tenant(options: { feature?: boolean } = {}) {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    if (options.feature !== false)
      await admin`
        insert into organisation_feature (organisation_id, feature, enabled, changed_by)
        values (${owner.organisationId}, 'bulk_actions', true, 'test')`
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const review = (input: { text?: string; rating?: number } = {}) =>
      seedLinkedReview(admin, {
        organisationId: owner.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
        ...input,
      })
    const requester = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      role: "member",
      canPublish: false,
    })
    /** A reply a member parked for approval, as the owner's inbox shows it. */
    const parked = async () => {
      const seeded = await review()
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
        shown: {
          reviewId: seeded.reviewId,
          draftId: draft.draftId,
          reviewUpdateTime: draft.expectedReviewUpdateTime,
        },
      }
    }
    const bulk = async (body: unknown, cookie = owner.cookie) => {
      const response = await fetch(`${server.baseUrl}/api/reviews/bulk`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      return response
    }
    const started = async (body: unknown, cookie = owner.cookie) => {
      const response = await bulk(body, cookie)
      expect(response.status, await response.clone().text()).toBe(200)
      return bulkReviewResultSchema.parse(await response.json())
    }
    const batch = async (
      id: string,
      cookie = owner.cookie
    ): Promise<BulkOperationView> => {
      const response = await fetch(
        `${server.baseUrl}/api/listings/bulk/${id}`,
        {
          headers: { cookie },
        }
      )
      expect(response.status, await response.clone().text()).toBe(200)
      return bulkOperationResponseSchema.parse(await response.json()).operation
    }
    const childFor = (op: BulkOperationView, reviewId: string) =>
      op.children.find((child) => child.reviewId === reviewId)!
    return {
      owner,
      requester,
      review,
      parked,
      bulk,
      started,
      batch,
      childFor,
    }
  }

  const decisions = async (reviewId: string) =>
    (
      await admin<{ count: number }[]>`
        select count(*)::int as count from approval_decision where review_id = ${reviewId}`
    )[0]!.count

  it("records the approvals, queues them, and publishes each once from the job tick", async () => {
    const t = await tenant()
    const a = await t.parked()
    const b = await t.parked()
    const stale = await t.parked()
    const result = await t.started({
      action: "approve",
      approvals: [a.shown, b.shown, { ...stale.shown, draftId: randomUUID() }],
    })
    expect(result.operationId).toBeDefined()
    expect(result.results).toEqual([
      { reviewId: a.reviewId, status: "queued" },
      { reviewId: b.reviewId, status: "queued" },
      {
        reviewId: stale.reviewId,
        status: "skipped",
        code: "approval_draft_changed",
      },
    ])
    // Decided now, sent later: nothing reached Google with the request.
    expect(await decisions(a.reviewId)).toBe(1)
    expect(await decisions(stale.reviewId)).toBe(0)
    expect(puts()).toHaveLength(0)

    const queued = await t.batch(result.operationId!)
    expect(queued).toMatchObject({
      operation: "review_approval",
      status: "running",
      requestedBy: t.owner.userId,
      approvedBy: t.owner.userId,
    })
    expect(t.childFor(queued, stale.reviewId)).toMatchObject({
      status: "skipped",
      skipReason: "approval_draft_changed",
    })

    await tick()
    expect(puts()).toHaveLength(2)
    // The outcome outlives the request that started it.
    const done = await t.batch(result.operationId!)
    expect(done.status).toBe("completed")
    for (const reviewId of [a.reviewId, b.reviewId]) {
      const child = t.childFor(done, reviewId)
      expect(child).toMatchObject({
        status: "succeeded",
        operation: "review_approval",
      })
      expect(child.publishAttemptId).toBeTruthy()
    }
    const [review] = await admin<{ workflow_status: string }[]>`
      select workflow_status from review where id = ${a.reviewId}`
    expect(review.workflow_status).toBe("published")
    // A second tick sends nothing more.
    await tick()
    expect(puts()).toHaveLength(2)
  })

  it("keeps the synchronous approve and refuses template batches with the feature off", async () => {
    const t = await tenant({ feature: false })
    const a = await t.parked()
    const result = await t.started({ action: "approve", approvals: [a.shown] })
    expect(result).toEqual({
      results: [{ reviewId: a.reviewId, status: "ok" }],
    })
    expect(puts()).toHaveLength(1)
    const template = await t.bulk({
      action: "template_reply",
      reviewIds: [a.reviewId],
    })
    expect(template.status).toBe(404)
  })

  it("does not publish an approval withdrawn after the batch started", async () => {
    const t = await tenant()
    const a = await t.parked()
    const result = await t.started({ action: "approve", approvals: [a.shown] })
    // The approver changes their mind before the runner reaches it.
    const rejected = await fetch(
      `${server.baseUrl}/api/reviews/${a.reviewId}/approval`,
      {
        method: "POST",
        headers: { cookie: t.owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ decision: "reject", draftId: a.shown.draftId }),
      }
    )
    expect(rejected.status, await rejected.clone().text()).toBeLessThan(300)
    await tick()
    expect(puts()).toHaveLength(0)
    const op = await t.batch(result.operationId!)
    expect(t.childFor(op, a.reviewId)).toMatchObject({
      status: "conflict",
      resultCode: "approval_withdrawn",
    })
    expect(op.status).toBe("completed_with_failures")
  })

  it("recovers an ambiguous publish through the reply pipeline and never sends it twice", async () => {
    const t = await tenant()
    const a = await t.parked()
    const result = await t.started({ action: "approve", approvals: [a.shown] })
    stub.respond({ method: "PUT", pathIncludes: "/reply" }, () => ({
      status: 500,
    }))
    await tick()
    expect(puts()).toHaveLength(1)
    let op = await t.batch(result.operationId!)
    const child = t.childFor(op, a.reviewId)
    expect(child).toMatchObject({
      status: "ambiguous",
      resultCode: "response_ambiguous",
      confirmationState: "unresolved",
    })
    expect(child.publishAttemptId).toBeTruthy()

    // Retry leaves a child whose publish is still unresolved alone.
    const retried = await fetch(
      `${server.baseUrl}/api/listings/bulk/${result.operationId}/retry`,
      { method: "POST", headers: { cookie: t.owner.cookie } }
    )
    expect(retried.status, await retried.clone().text()).toBeLessThan(300)
    op = await t.batch(result.operationId!)
    expect(t.childFor(op, a.reviewId).status).toBe("ambiguous")

    // Google did take it: the reply pipeline's readback settles the
    // attempt, and the child settles from that attempt.
    stub.reset()
    stub.respond({ method: "GET", pathIncludes: "/reviews/" }, () => ({
      status: 200,
      json: {
        reviewId: "stub",
        reviewReply: { comment: BODY, updateTime: "2026-08-20T10:00:00.000Z" },
      },
    }))
    await admin`update publish_attempt set next_attempt_at = now() where id = ${child.publishAttemptId!}`
    for (let round = 0; round < 3; round += 1) {
      await tick()
      op = await t.batch(result.operationId!)
      if (t.childFor(op, a.reviewId).status !== "ambiguous") break
    }
    expect(t.childFor(op, a.reviewId)).toMatchObject({
      status: "succeeded",
      confirmationState: "confirmed",
    })
    expect(puts()).toHaveLength(0)
    expect(op.status).toBe("completed")
  })

  it("resumes an interrupted batch through lease reclaim without a second send", async () => {
    const t = await tenant()
    const a = await t.parked()
    const result = await t.started({ action: "approve", approvals: [a.shown] })
    // The publish reached Google, then the runner died before settling the
    // child: its lease is left to run out.
    const published = await fetch(
      `${server.baseUrl}/api/reviews/${a.reviewId}/publish`,
      {
        method: "POST",
        headers: { cookie: t.owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          draftId: a.shown.draftId,
          expectedReviewUpdateTime: a.shown.reviewUpdateTime,
        }),
      }
    )
    expect(published.status, await published.clone().text()).toBe(200)
    expect(puts()).toHaveLength(1)
    await admin`
      update bulk_listing_child set status = 'running', attempts = 1, started_at = now() - interval '10 minutes',
        lease_expires_at = now() - interval '1 minute', next_attempt_at = null
      where operation_id = ${result.operationId!}`

    await tick() // the claim reclaims the lease: interrupted
    let op = await t.batch(result.operationId!)
    expect(t.childFor(op, a.reviewId)).toMatchObject({
      status: "ambiguous",
      resultCode: "execution_interrupted",
    })
    await tick() // queued again, and settled from the earlier publish
    op = await t.batch(result.operationId!)
    expect(t.childFor(op, a.reviewId)).toMatchObject({ status: "succeeded" })
    expect(t.childFor(op, a.reviewId).attempts).toBe(2)
    expect(puts()).toHaveLength(1)
    expect(op.status).toBe("completed")
  })

  it("never settles a retried child from its previous run's publish attempt", async () => {
    const t = await tenant()
    const a = await t.parked()
    const result = await t.started({ action: "approve", approvals: [a.shown] })
    // First run: Google refuses the reply outright (attempt X fails).
    stub.respond({ method: "PUT", pathIncludes: "/reply" }, () => ({
      status: 400,
      json: { error: { code: 400, status: "INVALID_ARGUMENT" } },
    }))
    await tick()
    let op = await t.batch(result.operationId!)
    const failed = t.childFor(op, a.reviewId)
    expect(failed.status).toBe("failed")
    const first = failed.publishAttemptId
    expect(first).toBeTruthy()
    stub.reset()

    // Retried and claimed, then the claim dies: its lease is left to run
    // out.
    const retried = await fetch(
      `${server.baseUrl}/api/listings/bulk/${result.operationId}/retry`,
      { method: "POST", headers: { cookie: t.owner.cookie } }
    )
    expect(retried.status, await retried.clone().text()).toBe(200)
    const claimed = await admin<{ child_id: string }[]>`
      select child_id::text from claim_due_bulk_children(10, 60, 2)`
    expect(claimed.map((row) => row.child_id)).toEqual([failed.id])
    const [claim] = await admin<{ publish_attempt_id: string | null }[]>`
      select publish_attempt_id::text from bulk_listing_child where id = ${failed.id}`
    // The claim forgets the earlier run's attempt (0131).
    expect(claim.publish_attempt_id).toBeNull()
    await admin`
      update bulk_listing_child set lease_expires_at = now() - interval '1 minute'
      where id = ${failed.id}`

    await tick() // the lease is reclaimed: interrupted, not settled from X
    op = await t.batch(result.operationId!)
    expect(t.childFor(op, a.reviewId)).toMatchObject({
      status: "ambiguous",
      resultCode: "execution_interrupted",
      publishAttemptId: null,
    })
    await tick() // requeued and run again, never settled from X
    op = await t.batch(result.operationId!)
    const settled = t.childFor(op, a.reviewId)
    expect(settled.attempts).toBe(3)
    // This run's own answer: the reply pipeline refuses to resend a
    // permanent rejection (previously it settled as publish_failed from X).
    expect(settled).toMatchObject({
      status: "conflict",
      resultCode: "previous_publish_failed",
    })
  })

  it("reports an approved reply another approver already published as sent", async () => {
    const t = await tenant()
    const a = await t.parked()
    const result = await t.started({ action: "approve", approvals: [a.shown] })
    const admin2 = await seedMemberUser(admin, {
      organisationId: t.owner.organisationId,
      role: "member",
      canPublish: true,
    })
    await admin`update member set role = 'admin' where user_id = ${admin2.userId}`
    // A second approver approves the same draft, which publishes it.
    const approved = await fetch(
      `${server.baseUrl}/api/reviews/${a.reviewId}/approval`,
      {
        method: "POST",
        headers: { cookie: admin2.cookie, "content-type": "application/json" },
        body: JSON.stringify({ decision: "approve", draftId: a.shown.draftId }),
      }
    )
    expect(approved.status, await approved.clone().text()).toBeLessThan(300)
    expect(puts()).toHaveLength(1)
    await tick()
    expect(puts()).toHaveLength(1)
    const op = await t.batch(result.operationId!)
    expect(t.childFor(op, a.reviewId)).toMatchObject({
      status: "succeeded",
      confirmationState: "confirmed",
    })
    expect(t.childFor(op, a.reviewId).publishAttemptId).toBeTruthy()
  })

  it("keeps each child's review and publish attempt in its own organisation", async () => {
    const t = await tenant()
    const other = await tenant()
    const a = await t.parked()
    const foreign = await other.parked()
    const result = await t.started({ action: "approve", approvals: [a.shown] })
    await other.started({ action: "approve", approvals: [foreign.shown] })
    await tick()
    const [foreignAttempt] = await admin<{ id: string }[]>`
      select pa.id::text from publish_attempt pa join review_reply rr on rr.id = pa.review_reply_id
      where rr.review_id = ${foreign.reviewId}`
    expect(foreignAttempt).toBeDefined()
    const [child] = await admin<{ id: string }[]>`
      select id::text from bulk_listing_child where operation_id = ${result.operationId!}`
    await expect(
      admin`update bulk_listing_child set review_id = ${foreign.reviewId} where id = ${child.id}`
    ).rejects.toMatchObject({ code: "23503" })
    await expect(
      admin`update bulk_listing_child set publish_attempt_id = ${foreignAttempt.id} where id = ${child.id}`
    ).rejects.toMatchObject({ code: "23503" })
    await expect(
      admin`
        insert into bulk_listing_child (operation_id, organisation_id, location_id, resource_key, seq, input, review_id)
        select operation_id, organisation_id, location_id, resource_key, 1, input, ${foreign.reviewId}
        from bulk_listing_child where id = ${child.id}`
    ).rejects.toMatchObject({ code: "23503" })
  })

  it("leaves a failed child alone on retry while its reply is still parked for resending", async () => {
    const t = await tenant()
    const a = await t.parked()
    const result = await t.started({ action: "approve", approvals: [a.shown] })
    await tick()
    let op = await t.batch(result.operationId!)
    const child = t.childFor(op, a.reviewId)
    expect(child.status).toBe("succeeded")
    // As if this run had failed while the reply pipeline still holds a
    // resend of its attempt.
    for (const status of ["started", "retryable", "ambiguous"]) {
      await admin`update publish_attempt set status = ${status} where id = ${child.publishAttemptId!}`
      await admin`
        update bulk_listing_child set status = 'failed', result_code = 'google_publish_failed'
        where id = ${child.id}`
      await admin`
        update bulk_listing_operation set status = 'completed_with_failures'
        where id = ${result.operationId!}`
      const retried = await fetch(
        `${server.baseUrl}/api/listings/bulk/${result.operationId}/retry`,
        { method: "POST", headers: { cookie: t.owner.cookie } }
      )
      expect(retried.status, await retried.clone().text()).toBeLessThan(500)
      op = await t.batch(result.operationId!)
      expect(t.childFor(op, a.reviewId).status, status).toBe("failed")
    }
    await admin`update publish_attempt set status = 'succeeded' where id = ${child.publishAttemptId!}`
  })

  it("requeues an interrupted child at most five times and only while its window is open", async () => {
    const t = await tenant()
    const a = await t.parked()
    const b = await t.parked()
    const result = await t.started({
      action: "approve",
      approvals: [a.shown, b.shown],
    })
    const interrupted = (reviewId: string, attempts: number) => admin`
      update bulk_listing_child set status = 'ambiguous', result_code = 'execution_interrupted',
        attempts = ${attempts}, finished_at = now(), next_attempt_at = null, lease_expires_at = null
      where operation_id = ${result.operationId!} and review_id = ${reviewId}`
    const status = async (reviewId: string) =>
      (
        await admin<{ status: string }[]>`
          select status from bulk_listing_child
          where operation_id = ${result.operationId!} and review_id = ${reviewId}`
      )[0]!.status
    const requeue = () => admin`select requeue_interrupted_review_children(100)`

    // The batch was finished by the tick that reclaimed the lease.
    await interrupted(a.reviewId, 5)
    await interrupted(b.reviewId, 4)
    await admin`
      update bulk_listing_operation set status = 'completed_with_failures', finished_at = now()
      where id = ${result.operationId!}`
    await requeue()
    expect(await status(a.reviewId)).toBe("ambiguous") // five runs: stops
    expect(await status(b.reviewId)).toBe("queued")
    const [reopened] = await admin<
      { status: string; finished_at: Date | null }[]
    >`
      select status, finished_at from bulk_listing_operation where id = ${result.operationId!}`
    expect(reopened).toMatchObject({ status: "running", finished_at: null })

    // A closed dispatch window requeues nothing.
    await interrupted(b.reviewId, 1)
    await admin`
      update bulk_listing_operation set dispatch_expires_at = now() - interval '1 minute'
      where id = ${result.operationId!}`
    await requeue()
    expect(await status(b.reviewId)).toBe("ambiguous")
  })

  it("refuses a member control of a batch they did not start or that is not a review batch", async () => {
    const t = await tenant()
    const a = await t.review({ text: "", rating: 4 })
    const result = await t.started(
      { action: "template_reply", reviewIds: [a.reviewId] },
      t.requester.cookie
    )
    const other = await seedMemberUser(admin, {
      organisationId: t.owner.organisationId,
      role: "member",
      canPublish: true,
    })
    const control = (verb: "cancel" | "retry", cookie: string) =>
      fetch(
        `${server.baseUrl}/api/listings/bulk/${result.operationId}/${verb}`,
        {
          method: "POST",
          headers: { cookie },
        }
      )
    await tick()
    await admin`
      update bulk_listing_operation set status = 'completed_with_failures'
      where id = ${result.operationId!}`
    // Another member may not retry a review batch they did not start.
    expect((await control("retry", other.cookie)).status).toBe(403)
    // Its own requester may, as long as it is a review batch...
    const own = await control("retry", t.requester.cookie)
    expect(own.status, await own.clone().text()).toBe(200)
    // ...but never a listing batch, even one they requested.
    await admin`
      update bulk_listing_operation set operation = 'regular_hours', status = 'running'
      where id = ${result.operationId!}`
    expect((await control("cancel", t.requester.cookie)).status).toBe(403)
    expect((await control("retry", t.requester.cookie)).status).toBe(403)
  })

  it("drafts, checks and publishes one template reply per eligible review, exactly once", async () => {
    const t = await tenant()
    const five = await t.review({ text: "", rating: 5 })
    const one = await t.review({ text: "", rating: 1 })
    const worded = await t.review({ text: "Lovely food.", rating: 5 })
    const result = await t.started({
      action: "template_reply",
      reviewIds: [five.reviewId, one.reviewId, worded.reviewId],
    })
    expect(result.results).toEqual([
      { reviewId: five.reviewId, status: "queued" },
      {
        reviewId: one.reviewId,
        status: "skipped",
        code: "template_low_rating",
      },
      {
        reviewId: worded.reviewId,
        status: "skipped",
        code: "template_review_has_text",
      },
    ])
    expect(puts()).toHaveLength(0)
    await tick()
    expect(puts()).toHaveLength(1)
    const op = await t.batch(result.operationId!)
    expect(op).toMatchObject({
      operation: "review_template_reply",
      status: "completed",
    })
    expect(t.childFor(op, five.reviewId)).toMatchObject({ status: "succeeded" })
    const drafts = await admin<{ source: string; created_by: string }[]>`
      select source, created_by::text from draft where review_id = ${five.reviewId}`
    expect(drafts).toEqual([{ source: "template", created_by: t.owner.userId }])

    // A re-run claim of the same child (as after a crash) finds its draft
    // and the settled publish: no second draft, no second send.
    await admin`
      update bulk_listing_child set status = 'queued', next_attempt_at = now(), finished_at = null
      where operation_id = ${result.operationId!} and review_id = ${five.reviewId}`
    await admin`update bulk_listing_operation set status = 'running', finished_at = null where id = ${result.operationId!}`
    await tick()
    expect(puts()).toHaveLength(1)
    const [{ count }] = await admin<{ count: number }[]>`
      select count(*)::int as count from draft where review_id = ${five.reviewId}`
    expect(count).toBe(1)
    const again = await t.batch(result.operationId!)
    expect(t.childFor(again, five.reviewId)).toMatchObject({
      status: "succeeded",
    })
  })

  it("submits a member's template replies for approval and lets them follow and cancel their own batch", async () => {
    const t = await tenant()
    const a = await t.review({ text: "", rating: 4 })
    const b = await t.review({ text: "", rating: 4 })
    const result = await t.started(
      {
        action: "template_reply",
        reviewIds: [a.reviewId, b.reviewId],
        includeLowRatings: true,
      },
      t.requester.cookie
    )
    expect(result.results.map((row) => row.status)).toEqual([
      "queued",
      "queued",
    ])
    // Another member cannot stop it; its requester can, before it runs.
    const other = await seedMemberUser(admin, {
      organisationId: t.owner.organisationId,
      role: "member",
      canPublish: true,
    })
    const refused = await fetch(
      `${server.baseUrl}/api/listings/bulk/${result.operationId}/cancel`,
      { method: "POST", headers: { cookie: other.cookie } }
    )
    expect(refused.status).toBe(403)

    // Run one child, then cancel the rest.
    await admin`
      update bulk_listing_child set next_attempt_at = now() + interval '1 hour'
      where operation_id = ${result.operationId!} and review_id = ${b.reviewId}`
    await tick()
    expect(puts()).toHaveLength(0)
    const cancelled = await fetch(
      `${server.baseUrl}/api/listings/bulk/${result.operationId}/cancel`,
      { method: "POST", headers: { cookie: t.requester.cookie } }
    )
    expect(cancelled.status, await cancelled.clone().text()).toBe(200)
    const op = await t.batch(result.operationId!, t.requester.cookie)
    expect(t.childFor(op, a.reviewId)).toMatchObject({
      status: "succeeded",
      resultCode: "submitted_for_approval",
    })
    expect(t.childFor(op, b.reviewId).status).toBe("cancelled")
    const [review] = await admin<{ workflow_status: string }[]>`
      select workflow_status from review where id = ${a.reviewId}`
    expect(review.workflow_status).toBe("awaiting_approval")
  })

  it("refuses a review change list on the listing bulk routes", async () => {
    const t = await tenant()
    const a = await t.review({ text: "", rating: 5 })
    const response = await fetch(
      `${server.baseUrl}/api/listings/bulk/preview`,
      {
        method: "POST",
        headers: { cookie: t.owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          locationIds: [a.locationId],
          input: {
            operation: "review_template_reply",
            reviewId: a.reviewId,
            reviewUpdateTime: new Date().toISOString(),
          },
        }),
      }
    )
    expect(response.status).toBe(400)
  })
})
