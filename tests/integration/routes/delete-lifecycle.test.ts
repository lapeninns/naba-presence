import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { sha256 } from "@/lib/server/crypto"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

type SeededDelete = {
  owner: Awaited<ReturnType<typeof createTestTenant>>
  review: Awaited<ReturnType<typeof seedLinkedReview>>
  replyId: string
}

const cases = [
  {
    name: "published reply",
    workflow: "published",
    publish: "published",
    google: true,
  },
  {
    name: "moderation-pending reply",
    workflow: "published",
    publish: "accepted",
    google: true,
  },
  {
    name: "rejected reply",
    workflow: "rejected",
    publish: "rejected",
    google: true,
  },
  {
    name: "awaiting approval (never sent)",
    workflow: "awaiting_approval",
    publish: "awaiting_approval",
    google: false,
  },
  {
    name: "failed reply with provider state",
    workflow: "failed",
    publish: "accepted",
    google: true,
  },
  {
    name: "ingestion-created reply without a draft",
    workflow: "published",
    publish: "published",
    google: true,
  },
] as const

describeDatabase("durable reply deletion", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function transitionReview(reviewId: string, target: string) {
    if (target === "published") {
      await admin`update review set workflow_status = 'published' where id = ${reviewId}`
      return
    }
    if (target === "rejected") {
      await admin`update review set workflow_status = 'published' where id = ${reviewId}`
      await admin`update review set workflow_status = 'rejected' where id = ${reviewId}`
      return
    }
    await admin`update review set workflow_status = 'drafted' where id = ${reviewId}`
    await admin`update review set workflow_status = 'verified' where id = ${reviewId}`
    if (target === "awaiting_approval") {
      await admin`update review set workflow_status = 'awaiting_approval' where id = ${reviewId}`
      return
    }
    await admin`update review set workflow_status = 'publish_requested' where id = ${reviewId}`
    if (target === "failed") {
      await admin`update review set workflow_status = 'failed' where id = ${reviewId}`
    }
  }

  async function seedDeleteState(input: {
    workflow: string
    publish: string
    providerUpdated?: boolean
  }): Promise<SeededDelete> {
    stub.reset()
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
    await transitionReview(review.reviewId, input.workflow)
    const [reply] = await admin<{ id: string }[]>`
      insert into review_reply (
        organisation_id,
        review_id,
        current_body,
        google_reply_state,
        publish_status,
        google_reply_updated_at
      )
      values (
        ${owner.organisationId},
        ${review.reviewId},
        'Reply to delete',
        ${input.publish === "rejected" ? "REJECTED" : "APPROVED"},
        ${input.publish},
        ${input.providerUpdated === false ? null : new Date()}
      )
      returning id::text as id
    `
    return { owner, review, replyId: reply.id }
  }

  function deleteReply(fixture: SeededDelete) {
    return fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}/reply`,
      {
        method: "DELETE",
        headers: { cookie: fixture.owner.cookie },
      }
    )
  }

  it.each(cases)(
    "deletes or cancels $name from its reachable state",
    async (testCase) => {
      const fixture = await seedDeleteState({
        workflow: testCase.workflow,
        publish: testCase.publish,
        providerUpdated: testCase.google,
      })

      const response = await deleteReply(fixture)
      expect(response.status).toBe(200)
      expect(
        stub.calls.filter((call) => call.method === "DELETE")
      ).toHaveLength(testCase.google ? 1 : 0)
      const [settled] = await admin<
        {
          publish_status: string
          workflow_status: string
          publish_generation: number
        }[]
      >`
        select
          rr.publish_status,
          r.workflow_status,
          rr.publish_generation
        from review_reply rr
        join review r on r.id = rr.review_id
        where rr.id = ${fixture.replyId}
      `
      expect(settled).toEqual(
        testCase.google
          ? {
              publish_status: "deleted",
              workflow_status: "new",
              publish_generation: 1,
            }
          : {
              publish_status: "not_published",
              workflow_status: "drafted",
              publish_generation: 0,
            }
      )
    }
  )

  it("cancels a publish parked on a back-off out of publish_requested", async () => {
    const fixture = await seedDeleteState({
      workflow: "publish_requested",
      publish: "accepted",
      providerUpdated: false,
    })
    const [queued] = await admin<{ id: string }[]>`
      insert into publish_attempt (
        organisation_id,
        review_reply_id,
        idempotency_key,
        request_body_hash,
        intended_body,
        status,
        attempt_no,
        operation,
        next_attempt_at,
        publish_generation
      )
      values (
        ${fixture.owner.organisationId},
        ${fixture.replyId},
        ${randomUUID()},
        ${sha256("Reply to delete")},
        'Reply to delete',
        'retryable',
        1,
        'publish',
        ${new Date(Date.now() + 60_000)},
        0
      )
      returning id::text as id
    `

    const response = await deleteReply(fixture)
    expect(response.status, await response.clone().text()).toBe(200)
    expect((await response.json()).status).toBe("cancelled")
    expect(stub.calls).toHaveLength(0)
    const [settled] = await admin<
      { publish_status: string; workflow_status: string }[]
    >`
      select rr.publish_status, r.workflow_status
      from review_reply rr
      join review r on r.id = rr.review_id
      where rr.id = ${fixture.replyId}
    `
    // 'drafted' is not reachable from 'publish_requested'; a withdrawn
    // publish intent settles 'failed', which is re-draftable.
    expect(settled).toEqual({
      publish_status: "not_published",
      workflow_status: "failed",
    })
    // The queued attempt must not survive the cancel, or the runner replays
    // the reply the operator just withdrew.
    const [retired] = await admin<
      { status: string; provider_error_code: string | null }[]
    >`
      select status, provider_error_code
      from publish_attempt
      where id = ${queued.id}
    `
    expect(retired).toEqual({
      status: "superseded",
      provider_error_code: "cancelled_locally",
    })
  })

  it("refuses delete while a publish attempt is in flight", async () => {
    const fixture = await seedDeleteState({
      workflow: "publish_requested",
      publish: "accepted",
      providerUpdated: false,
    })
    await admin`
      insert into publish_attempt (
        organisation_id,
        review_reply_id,
        idempotency_key,
        request_body_hash,
        intended_body,
        status,
        attempt_no,
        operation
      )
      values (
        ${fixture.owner.organisationId},
        ${fixture.replyId},
        ${randomUUID()},
        ${sha256("Reply to delete")},
        'Reply to delete',
        'started',
        1,
        'publish'
      )
    `

    const response = await deleteReply(fixture)
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe("publish_in_progress")
    expect(stub.calls).toHaveLength(0)
  })

  it("treats provider 404 as an idempotent successful delete", async () => {
    const fixture = await seedDeleteState({
      workflow: "published",
      publish: "published",
    })
    stub.respond({ method: "DELETE", pathIncludes: "/reply" }, () => ({
      status: 404,
      json: { error: { status: "NOT_FOUND" } },
    }))

    const response = await deleteReply(fixture)
    expect(response.status).toBe(200)
    const [attempt] = await admin<{ status: string; operation: string }[]>`
      select status, operation
      from publish_attempt
      where review_reply_id = ${fixture.replyId}
    `
    expect(attempt).toEqual({ status: "succeeded", operation: "delete" })
  })

  it("recovers a timed-out delete without issuing a second mutation", async () => {
    const fixture = await seedDeleteState({
      workflow: "published",
      publish: "published",
    })
    stub.respond({ method: "DELETE", pathIncludes: "/reply" }, () => ({
      status: 200,
      json: {},
      delayMs: 25_000,
    }))

    const first = await deleteReply(fixture)
    expect(first.status).toBe(502)
    expect((await first.json()).error).toBe("google_mutation_ambiguous")
    const [ambiguous] = await admin<
      { id: string; status: string; operation: string }[]
    >`
        select id::text as id, status, operation
        from publish_attempt
        where review_reply_id = ${fixture.replyId}
      `
    expect(ambiguous).toMatchObject({
      status: "ambiguous",
      operation: "delete",
    })

    stub.reset()
    stub.respond({ method: "GET", pathIncludes: "/reviews/" }, () => ({
      status: 200,
      json: { reviewId: "stub" },
    }))
    const second = await deleteReply(fixture)
    expect(second.status).toBe(200)
    expect(stub.calls.filter((call) => call.method === "GET")).toHaveLength(1)
    expect(stub.calls.filter((call) => call.method === "DELETE")).toHaveLength(
      0
    )
    const [settled] = await admin<
      { status: string; publish_generation: number }[]
    >`
        select pa.status, rr.publish_generation
        from publish_attempt pa
        join review_reply rr on rr.id = pa.review_reply_id
        where pa.id = ${ambiguous.id}
      `
    expect(settled).toEqual({
      status: "succeeded",
      publish_generation: 1,
    })
  }, 35_000)
})
