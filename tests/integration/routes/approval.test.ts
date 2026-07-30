import { randomBytes, randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { sha256 } from "@/lib/server/crypto"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  saveHumanDraft,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

type Actor = {
  userId: string
  cookie: string
}

describeDatabase("reply approval", () => {
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

  async function createActor(
    organisationId: string,
    input: {
      role: "owner" | "admin" | "member" | "viewer"
      canPublish: boolean
    }
  ): Promise<Actor> {
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
        ${`harness-${userId.slice(0, 8)}@nabapresence.test`},
        'Approval actor',
        ${organisationId}
      )
    `
    await admin`
      insert into member (
        organisation_id,
        user_id,
        role,
        can_publish
      )
      values (
        ${organisationId},
        ${userId},
        ${input.role},
        ${input.canPublish}
      )
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
    const draft = await saveHumanDraft(
      server.baseUrl,
      owner.cookie,
      review.reviewId,
      "Thank you for sharing your experience."
    )
    return { owner, review, draft }
  }

  function publish(
    fixture: Awaited<ReturnType<typeof createFixture>>,
    cookie: string
  ) {
    return fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}/publish`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          draftId: fixture.draft.draftId,
          expectedReviewUpdateTime:
            fixture.draft.expectedReviewUpdateTime,
        }),
      }
    )
  }

  function decide(
    fixture: Awaited<ReturnType<typeof createFixture>>,
    cookie: string,
    input: { decision: "approve" | "reject"; note?: string }
  ) {
    return fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}/approval`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(input),
      }
    )
  }

  it("attributes a request and publishes through an authorised approver", async () => {
    const fixture = await createFixture()
    const requester = await createActor(fixture.owner.organisationId, {
      role: "member",
      canPublish: false,
    })

    const requested = await publish(fixture, requester.cookie)
    expect(requested.status).toBe(202)
    const [pending] = await admin<{ approval_requested_by: string }[]>`
      select approval_requested_by::text as approval_requested_by
      from review_reply
      where review_id = ${fixture.review.reviewId}
    `
    expect(pending.approval_requested_by).toBe(requester.userId)

    const approved = await decide(fixture, fixture.owner.cookie, {
      decision: "approve",
    })
    expect(approved.status).toBe(200)
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(1)
    const [decision] = await admin<
      { decision: string; published_by: string }[]
    >`
      select
        ad.decision,
        rr.published_by::text as published_by
      from approval_decision ad
      join review_reply rr on rr.review_id = ad.review_id
      where ad.review_id = ${fixture.review.reviewId}
    `
    expect(decision).toEqual({
      decision: "approved",
      published_by: fixture.owner.userId,
    })
  })

  it("rejects an approval request back to draft with its note", async () => {
    const fixture = await createFixture()
    const requester = await createActor(fixture.owner.organisationId, {
      role: "member",
      canPublish: false,
    })
    expect((await publish(fixture, requester.cookie)).status).toBe(202)

    const rejected = await decide(fixture, fixture.owner.cookie, {
      decision: "reject",
      note: "Please make the reply more specific.",
    })
    expect(rejected.status).toBe(200)
    expect(await rejected.json()).toEqual({
      status: "returned_to_draft",
    })
    const [state] = await admin<
      {
        workflow_status: string
        publish_status: string
        decision: string
        note: string
      }[]
    >`
      select
        r.workflow_status,
        rr.publish_status,
        ad.decision,
        ad.note
      from review r
      join review_reply rr on rr.review_id = r.id
      join approval_decision ad on ad.review_id = r.id
      where r.id = ${fixture.review.reviewId}
    `
    expect(state).toEqual({
      workflow_status: "drafted",
      publish_status: "not_published",
      decision: "rejected",
      note: "Please make the reply more specific.",
    })
  })

  it("forbids a viewer from approving", async () => {
    const fixture = await createFixture()
    const requester = await createActor(fixture.owner.organisationId, {
      role: "member",
      canPublish: false,
    })
    const viewer = await createActor(fixture.owner.organisationId, {
      role: "viewer",
      canPublish: false,
    })
    expect((await publish(fixture, requester.cookie)).status).toBe(202)

    const response = await decide(fixture, viewer.cookie, {
      decision: "approve",
    })
    expect(response.status).toBe(403)
  })

  it("always requires a different approver in two-person mode", async () => {
    const fixture = await createFixture()
    await admin`
      update organisation
      set require_two_person_approval = true
      where id = ${fixture.owner.organisationId}
    `

    const requested = await publish(fixture, fixture.owner.cookie)
    expect(requested.status).toBe(202)
    const sameUser = await decide(fixture, fixture.owner.cookie, {
      decision: "approve",
    })
    expect(sameUser.status).toBe(403)
    expect((await sameUser.json()).error).toBe("second_approver_required")

    const secondAdmin = await createActor(fixture.owner.organisationId, {
      role: "admin",
      canPublish: true,
    })
    const approved = await decide(fixture, secondAdmin.cookie, {
      decision: "approve",
    })
    expect(approved.status).toBe(200)
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(1)
  })

  it("returns 404 for a cross-tenant approval", async () => {
    const fixture = await createFixture()
    const requester = await createActor(fixture.owner.organisationId, {
      role: "member",
      canPublish: false,
    })
    expect((await publish(fixture, requester.cookie)).status).toBe(202)
    const otherOwner = await createTestTenant(admin)
    organisations.push(otherOwner.organisationId)

    const response = await decide(fixture, otherOwner.cookie, {
      decision: "approve",
    })
    expect(response.status).toBe(404)
  })
})
