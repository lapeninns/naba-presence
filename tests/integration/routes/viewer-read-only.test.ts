import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  saveHumanDraft,
  seedAwaitingApprovalPost,
  seedGoogleConnection,
  seedLinkedLocation,
  seedLinkedReview,
  seedMemberUser,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

// A viewer reads; it never changes anything (lib/server/permissions.ts
// requireLocationAction). Every case below was a 2xx for a viewer before the
// shared action guard, and each asserts the row is untouched afterwards, so
// a 403 that still wrote cannot pass.
describeDatabase("viewer is read-only (requireLocationAction)", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    server = await startAppServer({
      GBP_POSTS_ENABLED: "true",
      PUBLISH_ENABLED: "true",
    })
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  const send = (cookie: string, method: string, path: string, body?: unknown) =>
    fetch(`${server.baseUrl}${path}`, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  const standardPost = (summary: string) => ({
    topicType: "STANDARD",
    languageCode: "en-GB",
    summary,
    media: [],
  })

  async function fixture() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    // An org-level can_publish must not lift a viewer above read.
    const viewer = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      role: "viewer",
      canPublish: true,
    })
    return { owner, connection, linked, viewer }
  }

  async function expectDenied(response: Response) {
    expect(response.status, await response.clone().text()).toBe(403)
    expect(((await response.json()) as { error: string }).error).toBe(
      "permission_denied"
    )
  }

  it("refuses post draft create, update, delete and publish-request", async () => {
    const { owner, linked, viewer } = await fixture()
    const base = `/api/locations/${linked.locationId}/posts`

    await expectDenied(
      await send(viewer.cookie, "POST", base, standardPost("Viewer"))
    )

    const created = await send(
      owner.cookie,
      "POST",
      base,
      standardPost("Owner")
    )
    expect(created.status, await created.clone().text()).toBe(201)
    const { post } = (await created.json()) as { post: { id: string } }

    await expectDenied(
      await send(
        viewer.cookie,
        "PATCH",
        `${base}/${post.id}`,
        standardPost("Edited")
      )
    )
    await expectDenied(
      await send(viewer.cookie, "POST", `${base}/${post.id}/publish`)
    )
    await expectDenied(
      await send(viewer.cookie, "DELETE", `${base}/${post.id}`)
    )

    const rows = await admin<{ summary: string; status: string }[]>`
      select summary, status from gbp_local_post
      where location_id = ${linked.locationId}
    `
    expect(rows).toEqual([{ summary: "Owner", status: "draft" }])
  })

  it("refuses to reject or approve a post awaiting approval", async () => {
    const { owner, linked, viewer } = await fixture()
    const post = await seedAwaitingApprovalPost(admin, {
      organisationId: owner.organisationId,
      locationId: linked.locationId,
      requestedBy: owner.userId,
    })
    const path = `/api/locations/${linked.locationId}/posts/${post.id}/approval`
    await expectDenied(
      await send(viewer.cookie, "POST", path, { decision: "reject" })
    )
    await expectDenied(
      await send(viewer.cookie, "POST", path, { decision: "approve" })
    )

    const [row] = await admin<{ status: string }[]>`
      select status from gbp_local_post where id = ${post.id}
    `
    expect(row.status).toBe("awaiting_approval")
  })

  it("refuses a drafting member's approval decision on a post", async () => {
    const { owner, linked } = await fixture()
    const drafter = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      role: "member",
      canPublish: false,
    })
    const post = await seedAwaitingApprovalPost(admin, {
      organisationId: owner.organisationId,
      locationId: linked.locationId,
      requestedBy: owner.userId,
    })
    const path = `/api/locations/${linked.locationId}/posts/${post.id}/approval`
    await expectDenied(
      await send(drafter.cookie, "POST", path, { decision: "reject" })
    )
    const [row] = await admin<{ status: string }[]>`
      select status from gbp_local_post where id = ${post.id}
    `
    expect(row.status).toBe("awaiting_approval")
  })

  it("refuses a reply draft and a reply approval request", async () => {
    const { owner, connection, viewer } = await fixture()
    const review = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })

    await expectDenied(
      await send(
        viewer.cookie,
        "POST",
        `/api/reviews/${review.reviewId}/drafts`,
        {
          tone: "warm_professional",
          body: "Viewer reply",
        }
      )
    )

    const draft = await saveHumanDraft(
      server.baseUrl,
      owner.cookie,
      review.reviewId,
      "Thank you for visiting."
    )
    await expectDenied(
      await send(
        viewer.cookie,
        "POST",
        `/api/reviews/${review.reviewId}/publish`,
        {
          draftId: draft.draftId,
          expectedReviewUpdateTime: draft.expectedReviewUpdateTime,
        }
      )
    )
    const [row] = await admin<{ workflowStatus: string }[]>`
      select workflow_status as "workflowStatus" from review
      where id = ${review.reviewId}
    `
    expect(row.workflowStatus).not.toBe("awaiting_approval")
  })

  it("refuses bulk assign and mark-reviewed", async () => {
    const { owner, connection, viewer } = await fixture()
    const review = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    await expectDenied(
      await send(viewer.cookie, "POST", "/api/reviews/bulk", {
        action: "assign",
        reviewIds: [review.reviewId],
        assigneeId: viewer.userId,
      })
    )
    await expectDenied(
      await send(viewer.cookie, "POST", "/api/reviews/bulk", {
        action: "mark_reviewed",
        reviewIds: [review.reviewId],
      })
    )
    const [row] = await admin<
      { assignedTo: string | null; triagedAt: Date | null }[]
    >`
      select assigned_to::text as "assignedTo", triaged_at as "triagedAt"
      from review where id = ${review.reviewId}
    `
    expect(row).toEqual({ assignedTo: null, triagedAt: null })
  })
})
