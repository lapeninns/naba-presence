import { randomBytes, randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  reviewCountsSchema,
  reviewDetailSchema,
  reviewRowSchema,
  reviewsPageSchema,
} from "@/lib/contracts/reviews"
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
          expectedReviewUpdateTime: fixture.draft.expectedReviewUpdateTime,
        }),
      }
    )
  }

  function decide(
    fixture: Awaited<ReturnType<typeof createFixture>>,
    cookie: string,
    input: {
      decision: "approve" | "reject"
      draftId?: string
      expectedReviewUpdateTime?: string
      note?: string
    }
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

  // The approver reads one draft. Resolving "the newest verified draft"
  // server-side published a different one whenever the request named an older
  // draft than the review's newest — with an approval_decision row and an
  // audit event both asserting the approver had read it.
  it("decides the parked draft, not the newest verified one", async () => {
    const fixture = await createFixture()
    const requester = await createActor(fixture.owner.organisationId, {
      role: "member",
      canPublish: false,
    })
    const newer = await saveHumanDraft(
      server.baseUrl,
      fixture.owner.cookie,
      fixture.review.reviewId,
      "A newer draft nobody submitted for approval."
    )

    expect((await publish(fixture, requester.cookie)).status).toBe(202)
    const [parked] = await admin<{ pending_draft_id: string | null }[]>`
      select pending_draft_id::text as pending_draft_id
      from review_reply
      where review_id = ${fixture.review.reviewId}
    `
    expect(parked.pending_draft_id).toBe(fixture.draft.draftId)

    const approved = await decide(fixture, fixture.owner.cookie, {
      decision: "approve",
    })
    expect(approved.status).toBe(200)
    const [decision] = await admin<{ draft_id: string }[]>`
      select draft_id::text as draft_id
      from approval_decision
      where review_id = ${fixture.review.reviewId}
    `
    expect(decision.draft_id).toBe(fixture.draft.draftId)
    expect(decision.draft_id).not.toBe(newer.draftId)
    const put = stub.calls.find((call) => call.method === "PUT")
    expect((put?.body as { comment: string }).comment).toBe(
      "Thank you for sharing your experience."
    )
  })

  it("refuses a decision that names a draft other than the parked one", async () => {
    const fixture = await createFixture()
    const requester = await createActor(fixture.owner.organisationId, {
      role: "member",
      canPublish: false,
    })
    const newer = await saveHumanDraft(
      server.baseUrl,
      fixture.owner.cookie,
      fixture.review.reviewId,
      "A newer draft the approver never saw."
    )
    expect((await publish(fixture, requester.cookie)).status).toBe(202)

    const stale = await decide(fixture, fixture.owner.cookie, {
      decision: "approve",
      draftId: newer.draftId,
    })
    expect(stale.status).toBe(409)
    expect((await stale.json()).error).toBe("approval_draft_changed")
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(0)
    const decisions = await admin`
      select 1 from approval_decision where review_id = ${fixture.review.reviewId}
    `
    expect(decisions).toHaveLength(0)
  })

  // What the inbox pane binds an approval to (components/inbox/action-bar.tsx):
  // the draft the composer shows — the parked one, `pendingDraft`, else the
  // newest (shownDraft in lib/inbox/review-situation.ts) — and the review's
  // update time.
  async function readPane(
    fixture: Awaited<ReturnType<typeof createFixture>>,
    cookie: string
  ) {
    const response = await fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}`,
      { headers: { cookie } }
    )
    expect(response.status).toBe(200)
    const { review } = (await response.json()) as {
      review: {
        updateTime: string
        drafts: { id: string; body: string }[]
        pendingDraft?: { id: string; body: string } | null
      }
    }
    const shown = review.pendingDraft ?? review.drafts[0]
    return {
      draftId: shown.id,
      expectedReviewUpdateTime: review.updateTime,
      body: shown.body,
      newestDraftId: review.drafts[0].id,
    }
  }

  async function insertNewerDraft(
    fixture: Awaited<ReturnType<typeof createFixture>>
  ) {
    const [draft] = await admin<{ id: string }[]>`
      insert into draft (
        organisation_id, review_id, source, tone, body, body_bytes,
        evidence_hash, verification_status, created_at
      )
      select organisation_id, review_id, 'human', tone,
        'A newer draft nobody submitted.',
        octet_length('A newer draft nobody submitted.'),
        evidence_hash, verification_status, created_at + interval '1 minute'
      from draft
      where id = ${fixture.draft.draftId}
      returning id::text as id
    `
    return draft.id
  }

  async function expectNothingDecided(
    fixture: Awaited<ReturnType<typeof createFixture>>
  ) {
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(0)
    const decisions = await admin`
      select 1 from approval_decision where review_id = ${fixture.review.reviewId}
    `
    expect(decisions).toHaveLength(0)
  }

  it("approves what the pane shows when nothing changed", async () => {
    const fixture = await createFixture()
    const requester = await createActor(fixture.owner.organisationId, {
      role: "member",
      canPublish: false,
    })
    expect((await publish(fixture, requester.cookie)).status).toBe(202)

    const { draftId, expectedReviewUpdateTime } = await readPane(
      fixture,
      fixture.owner.cookie
    )
    expect(draftId).toBe(fixture.draft.draftId)
    const approved = await decide(fixture, fixture.owner.cookie, {
      decision: "approve",
      draftId,
      expectedReviewUpdateTime,
    })
    expect(approved.status).toBe(200)
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(1)
  })

  // A draft newer than the parked one (one nobody submitted) used to be what
  // the pane showed and named, so Approve answered 409 every time. The pane
  // now reads the parked draft from the detail, shows its text and names it.
  it("approves the parked draft the pane shows when a newer draft exists", async () => {
    const fixture = await createFixture()
    const requester = await createActor(fixture.owner.organisationId, {
      role: "member",
      canPublish: false,
    })
    expect((await publish(fixture, requester.cookie)).status).toBe(202)
    const [parked] = await admin<{ body: string }[]>`
      select body from draft where id = ${fixture.draft.draftId}
    `
    const newer = await insertNewerDraft(fixture)

    const pane = await readPane(fixture, fixture.owner.cookie)
    expect(pane.newestDraftId).toBe(newer)
    expect(pane.draftId).toBe(fixture.draft.draftId)
    expect(pane.body).toBe(parked.body)
    const approved = await decide(fixture, fixture.owner.cookie, {
      decision: "approve",
      draftId: pane.draftId,
      expectedReviewUpdateTime: pane.expectedReviewUpdateTime,
    })
    expect(approved.status).toBe(200)
    const puts = stub.calls.filter((call) => call.method === "PUT")
    expect(puts).toHaveLength(1)
    expect((puts[0].body as { comment: string }).comment).toBe(parked.body)
  })

  // A client that names a draft other than the parked one (an older pane
  // that showed the newest) never read what would publish: refused.
  it("refuses an approval naming a draft that is not the parked one", async () => {
    const fixture = await createFixture()
    const requester = await createActor(fixture.owner.organisationId, {
      role: "member",
      canPublish: false,
    })
    expect((await publish(fixture, requester.cookie)).status).toBe(202)
    const newer = await insertNewerDraft(fixture)

    const pane = await readPane(fixture, fixture.owner.cookie)
    const stale = await decide(fixture, fixture.owner.cookie, {
      decision: "approve",
      draftId: newer,
      expectedReviewUpdateTime: pane.expectedReviewUpdateTime,
    })
    expect(stale.status).toBe(409)
    expect((await stale.json()).error).toBe("approval_draft_changed")
    await expectNothingDecided(fixture)
  })

  it("leaves pendingDraft null once the reply is no longer parked", async () => {
    const fixture = await createFixture()
    const response = await fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}`,
      { headers: { cookie: fixture.owner.cookie } }
    )
    expect((await response.json()).review.pendingDraft).toBeNull()
  })

  it("refuses an approval when the review changed after the pane loaded", async () => {
    const fixture = await createFixture()
    const requester = await createActor(fixture.owner.organisationId, {
      role: "member",
      canPublish: false,
    })
    expect((await publish(fixture, requester.cookie)).status).toBe(202)
    const pane = await readPane(fixture, fixture.owner.cookie)
    await admin`
      update review
      set update_time = update_time + interval '1 minute',
        review_text = 'Edited on Google after the pane loaded.'
      where id = ${fixture.review.reviewId}
    `

    const stale = await decide(fixture, fixture.owner.cookie, {
      decision: "approve",
      draftId: pane.draftId,
      expectedReviewUpdateTime: pane.expectedReviewUpdateTime,
    })
    expect(stale.status).toBe(409)
    expect((await stale.json()).error).toBe("review_changed")
    await expectNothingDecided(fixture)
  })

  // The harness runs without OpenAI credentials, which is a supported install:
  // the semantic pass does not run, and the stored row must not claim it did.
  it("records only the checks that ran", async () => {
    const fixture = await createFixture()
    const [verification] = await admin<
      { checks_version: string; verdict: string }[]
    >`
      select checks_version, verdict
      from verification_result
      where draft_id = ${fixture.draft.draftId}
    `
    expect(verification.checks_version).toBe("deterministic-v1")
    expect(verification.verdict).toBe("pass")
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
    // Plus the review as it now stands (row, detail): see
    // review-write-snapshot.test.ts.
    const rejectedBody = await rejected.json()
    expect(rejectedBody).toMatchObject({ status: "returned_to_draft" })
    expect(rejectedBody.row.workflowStatus).toBe("drafted")
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

    // The author reads the note on the review itself; it used to be stored
    // and never returned.
    const detail = await fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}`,
      { headers: { cookie: requester.cookie } }
    )
    expect(detail.status).toBe(200)
    const body = (await detail.json()) as {
      review: {
        lastRejection: { note: string | null; decidedAt: string } | null
        timeline: { action: string; metadataSummary: string | null }[]
      }
    }
    expect(body.review.lastRejection?.note).toBe(
      "Please make the reply more specific."
    )
    expect(typeof body.review.lastRejection?.decidedAt).toBe("string")
    expect(
      body.review.timeline.find(
        (event) => event.action === "review.approval.rejected"
      )?.metadataSummary
    ).toBe("Note: Please make the reply more specific.")

    // Resubmitting takes it out of draft, and the old rejection goes with it.
    const again = await publish(fixture, requester.cookie)
    expect(again.status, await again.clone().text()).toBe(202)
    const resubmitted = (await (
      await fetch(`${server.baseUrl}/api/reviews/${fixture.review.reviewId}`, {
        headers: { cookie: requester.cookie },
      })
    ).json()) as { review: { lastRejection: unknown } }
    expect(resubmitted.review.lastRejection).toBeNull()
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

  // Two-person means the approver is neither the requester nor the draft's
  // author: an author approving a draft somebody else submitted is still one
  // person vouching for their own text.
  it("refuses the draft's author as approver in two-person mode, whoever asked", async () => {
    // createFixture's draft is written by the owner.
    const fixture = await createFixture()
    await admin`
      update organisation
      set require_two_person_approval = true
      where id = ${fixture.owner.organisationId}
    `
    const requester = await createActor(fixture.owner.organisationId, {
      role: "member",
      canPublish: false,
    })
    expect((await publish(fixture, requester.cookie)).status).toBe(202)

    const byAuthor = await decide(fixture, fixture.owner.cookie, {
      decision: "approve",
    })
    expect(byAuthor.status).toBe(403)
    expect((await byAuthor.json()).error).toBe("second_approver_required")
    const [recorded] = await admin<{ count: number }[]>`
      select count(*)::integer as count from approval_decision
      where review_id = ${fixture.review.reviewId}
    `
    expect(recorded.count).toBe(0)
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(0)

    const secondAdmin = await createActor(fixture.owner.organisationId, {
      role: "admin",
      canPublish: true,
    })
    const approved = await decide(fixture, secondAdmin.cookie, {
      decision: "approve",
    })
    expect(approved.status, await approved.clone().text()).toBe(200)
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(1)
  })

  // Plan D1 (R01b): the detail says what a press will do. The flag and the
  // scope are read-only; the approval route above still decides.
  it("tells each person on the detail who a two-person approval waits on", async () => {
    const fixture = await createFixture()
    async function capabilities(cookie: string) {
      const response = await fetch(
        `${server.baseUrl}/api/reviews/${fixture.review.reviewId}`,
        { headers: { cookie } }
      )
      expect(response.status).toBe(200)
      const { review } = reviewDetailSchema.parse(await response.json())
      return review.capabilities
    }

    expect(await capabilities(fixture.owner.cookie)).toMatchObject({
      requireTwoPersonApproval: false,
      approvalScope: null,
      canApprove: false,
    })

    await admin`
      update organisation
      set require_two_person_approval = true
      where id = ${fixture.owner.organisationId}
    `
    expect(await capabilities(fixture.owner.cookie)).toMatchObject({
      canPublish: true,
      requireTwoPersonApproval: true,
      approvalScope: null,
    })

    // The owner publishes; two-person mode parks it, as before.
    expect((await publish(fixture, fixture.owner.cookie)).status).toBe(202)
    expect(await capabilities(fixture.owner.cookie)).toMatchObject({
      requireTwoPersonApproval: true,
      approvalScope: "others",
      canApprove: false,
    })

    const secondAdmin = await createActor(fixture.owner.organisationId, {
      role: "admin",
      canPublish: true,
    })
    expect(await capabilities(secondAdmin.cookie)).toMatchObject({
      approvalScope: "me",
      canApprove: true,
    })

    const viewer = await createActor(fixture.owner.organisationId, {
      role: "viewer",
      canPublish: false,
    })
    expect(await capabilities(viewer.cookie)).toMatchObject({
      approvalScope: "others",
      canApprove: false,
    })
  })

  // The draft's author may not approve under two-person approval, whoever
  // asked (see above), but may still reject: the scope is the Inbox's
  // `awaiting_my_approval` predicate, and `canApprove` is the narrower rule.
  it("lets the draft's author reject but not approve under two-person approval", async () => {
    // createFixture's draft is written by the owner.
    const fixture = await createFixture()
    await admin`
      update organisation
      set require_two_person_approval = true
      where id = ${fixture.owner.organisationId}
    `
    const requester = await createActor(fixture.owner.organisationId, {
      role: "member",
      canPublish: false,
    })
    expect((await publish(fixture, requester.cookie)).status).toBe(202)

    async function scope(cookie: string) {
      const response = await fetch(
        `${server.baseUrl}/api/reviews/${fixture.review.reviewId}`,
        { headers: { cookie } }
      )
      const { review } = reviewDetailSchema.parse(await response.json())
      const { approvalScope, canApprove } = review.capabilities
      return { approvalScope, canApprove }
    }
    expect(await scope(fixture.owner.cookie)).toEqual({
      approvalScope: "me",
      canApprove: false,
    })
    expect(await scope(requester.cookie)).toEqual({
      approvalScope: "others",
      canApprove: false,
    })
    const secondAdmin = await createActor(fixture.owner.organisationId, {
      role: "admin",
      canPublish: true,
    })
    expect(await scope(secondAdmin.cookie)).toEqual({
      approvalScope: "me",
      canApprove: true,
    })

    // What the detail says is what the route does: the author's approve is
    // refused, their reject is accepted.
    const approved = await decide(fixture, fixture.owner.cookie, {
      decision: "approve",
    })
    expect(approved.status).toBe(403)
    expect((await approved.json()).error).toBe("second_approver_required")
    const rejected = await decide(fixture, fixture.owner.cookie, {
      decision: "reject",
      note: "Needs a warmer opening.",
    })
    expect(rejected.status, await rejected.clone().text()).toBe(200)
    expect(await rejected.json()).toMatchObject({ status: "returned_to_draft" })
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(0)
  })

  // The Inbox badge and title count replies a person could approve, not every
  // reply in their `awaiting_my_approval` queue: the draft's author stays in
  // the queue (they may reject) but cannot approve, so it must not be counted
  // as waiting on their approval. The parked draft is resolved as the route
  // does, including the legacy fallback when `pending_draft_id` is null.
  it("counts on the badge only the parked replies this person could approve (R03)", async () => {
    // createFixture's draft is written by the owner.
    const fixture = await createFixture()
    await admin`
      update organisation
      set require_two_person_approval = true
      where id = ${fixture.owner.organisationId}
    `
    const requester = await createActor(fixture.owner.organisationId, {
      role: "member",
      canPublish: false,
    })
    const viewer = await createActor(fixture.owner.organisationId, {
      role: "viewer",
      canPublish: false,
    })
    const secondAdmin = await createActor(fixture.owner.organisationId, {
      role: "admin",
      canPublish: true,
    })
    expect((await publish(fixture, requester.cookie)).status).toBe(202)

    async function badge(cookie: string) {
      const response = await fetch(`${server.baseUrl}/api/reviews/counts`, {
        headers: { cookie },
      })
      expect(response.status).toBe(200)
      const body = reviewCountsSchema.parse(await response.json())
      return {
        queue: body.byQueue.awaiting_my_approval,
        approvable: body.approvableByMe,
      }
    }
    // Author (owner): still in their queue, but not theirs to approve.
    expect(await badge(fixture.owner.cookie)).toEqual({
      queue: 1,
      approvable: 0,
    })
    // Requester: excluded by the queue already. No publish permission: same.
    expect(await badge(requester.cookie)).toEqual({ queue: 0, approvable: 0 })
    expect(await badge(viewer.cookie)).toEqual({ queue: 0, approvable: 0 })
    // A different publisher can approve it.
    expect(await badge(secondAdmin.cookie)).toEqual({
      queue: 1,
      approvable: 1,
    })

    // A reply parked before `pending_draft_id` existed: the newest verified
    // draft is the parked one, and its author is still excluded.
    await admin`
      update review_reply set pending_draft_id = null
      where review_id = ${fixture.review.reviewId}
    `
    expect(await badge(fixture.owner.cookie)).toEqual({
      queue: 1,
      approvable: 0,
    })
    expect(await badge(secondAdmin.cookie)).toEqual({
      queue: 1,
      approvable: 1,
    })

    // The count is the route's rule: it refuses the author, accepts the other.
    const refused = await decide(fixture, fixture.owner.cookie, {
      decision: "approve",
    })
    expect(refused.status).toBe(403)
    expect((await refused.json()).error).toBe("second_approver_required")

    // With the two-person rule off, the author may approve, so it counts.
    await admin`
      update organisation
      set require_two_person_approval = false
      where id = ${fixture.owner.organisationId}
    `
    expect(await badge(fixture.owner.cookie)).toEqual({
      queue: 1,
      approvable: 1,
    })
  })

  // The inbox's bulk bar reads `canApprove` off the list row, which
  // lib/server/reviews-query.ts computes in SQL; the approval route
  // (lib/server/review-approval.ts) decides in TypeScript. Two copies of one
  // rule: this pins the row to what the route does for each kind of person,
  // so they cannot drift apart silently.
  it("agrees between the list row's canApprove and the approval route", async () => {
    const fixture = await createFixture()
    async function rowCanApprove(cookie: string) {
      const response = await fetch(
        `${server.baseUrl}/api/reviews?page_size=100`,
        { headers: { cookie } }
      )
      expect(response.status).toBe(200)
      const page = reviewsPageSchema.parse(await response.json())
      const row = page.items.find((item) => item.id === fixture.review.reviewId)
      expect(row).toBeDefined()
      return row!.canApprove
    }
    // The route says no with `second_approver_required`; anything else (the
    // decision is recorded, or a different refusal) is not that rule.
    async function routeRefusesAsSecondApprover(
      cookie: string,
      decision: "approve" | "reject"
    ) {
      const response = await decide(fixture, cookie, {
        decision,
        ...(decision === "reject" ? { note: "Needs a warmer opening." } : {}),
      })
      const body = (await response.json()) as { error?: string }
      return (
        response.status === 403 && body.error === "second_approver_required"
      )
    }

    // Not parked: nothing to approve, so the row says nothing.
    expect(await rowCanApprove(fixture.owner.cookie)).toBeNull()

    await admin`
      update organisation
      set require_two_person_approval = true
      where id = ${fixture.owner.organisationId}
    `
    // The owner wrote the draft (createFixture); a second publisher asks.
    const requester = await createActor(fixture.owner.organisationId, {
      role: "admin",
      canPublish: true,
    })
    const independent = await createActor(fixture.owner.organisationId, {
      role: "admin",
      canPublish: true,
    })
    const requested = await publish(fixture, requester.cookie)
    expect(requested.status).toBe(202)
    // The row a write hands back is the one the client patches into every
    // loaded list, so it must carry the same answer as the list itself.
    const handedBack = reviewRowSchema.parse(
      ((await requested.json()) as { row?: unknown }).row
    )
    expect(handedBack.canApprove).toBe(false)

    // Row first, then the route, for each person; the approving press is
    // last because it publishes.
    const people = [
      { who: "the requester", cookie: requester.cookie, canApprove: false },
      {
        who: "the draft's author",
        cookie: fixture.owner.cookie,
        canApprove: false,
      },
      {
        who: "an independent approver",
        cookie: independent.cookie,
        canApprove: true,
      },
    ]
    for (const person of people) {
      expect(await rowCanApprove(person.cookie), person.who).toBe(
        person.canApprove
      )
    }
    for (const person of people.filter((p) => !p.canApprove)) {
      expect(
        await routeRefusesAsSecondApprover(person.cookie, "approve"),
        person.who
      ).toBe(true)
    }
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(0)
    const approved = await decide(fixture, independent.cookie, {
      decision: "approve",
    })
    expect(approved.status, await approved.clone().text()).toBe(200)
    expect(stub.calls.filter((call) => call.method === "PUT")).toHaveLength(1)
  })

  it("says the owner may approve when the two-person rule is off", async () => {
    const fixture = await createFixture()
    const requester = await createActor(fixture.owner.organisationId, {
      role: "member",
      canPublish: false,
    })
    expect((await publish(fixture, requester.cookie)).status).toBe(202)
    const response = await fetch(
      `${server.baseUrl}/api/reviews?page_size=100`,
      {
        headers: { cookie: fixture.owner.cookie },
      }
    )
    const page = reviewsPageSchema.parse(await response.json())
    expect(
      page.items.find((item) => item.id === fixture.review.reviewId)?.canApprove
    ).toBe(true)
    const approved = await decide(fixture, fixture.owner.cookie, {
      decision: "approve",
    })
    expect(approved.status, await approved.clone().text()).toBe(200)
  })

  // Only the two-person rule takes Approve from the author: with it off, the
  // author who may publish approves a request as before.
  it("keeps Approve for the draft's author when the two-person rule is off", async () => {
    // createFixture's draft is written by the owner.
    const fixture = await createFixture()
    const requester = await createActor(fixture.owner.organisationId, {
      role: "member",
      canPublish: false,
    })
    expect((await publish(fixture, requester.cookie)).status).toBe(202)
    const response = await fetch(
      `${server.baseUrl}/api/reviews/${fixture.review.reviewId}`,
      { headers: { cookie: fixture.owner.cookie } }
    )
    const { review } = reviewDetailSchema.parse(await response.json())
    expect(review.capabilities).toMatchObject({
      requireTwoPersonApproval: false,
      approvalScope: "me",
      canApprove: true,
    })
    const approved = await decide(fixture, fixture.owner.cookie, {
      decision: "approve",
    })
    expect(approved.status, await approved.clone().text()).toBe(200)
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
