import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  reviewDetailSchema,
  reviewRowSchema,
  reviewsPageSchema,
} from "@/lib/contracts/reviews"

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

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

/**
 * WP-09: every single-review write answers with the review as it now stands —
 * `row` exactly as the list reads it, `detail` exactly as the detail route
 * reads it — so the client patches both caches instead of re-reading every
 * loaded list page.
 */
describeDatabase("review write snapshots", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
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
    return { owner, review, reviewId: review.reviewId }
  }

  function call(
    path: string,
    cookie: string,
    init: { method?: string; body?: unknown } = {}
  ) {
    return fetch(`${server.baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        cookie,
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  }

  /** The snapshot must equal what the list and detail routes now read. */
  async function expectCurrentSnapshot(
    body: { row?: unknown; detail?: unknown },
    reviewId: string,
    cookie: string,
    workflowStatus: string
  ) {
    const row = reviewRowSchema.parse(body.row)
    const detail = reviewDetailSchema.parse(body.detail)
    expect(row.id).toBe(reviewId)
    expect(row.workflowStatus).toBe(workflowStatus)
    expect(detail.review.workflowStatus).toBe(workflowStatus)

    const list = reviewsPageSchema.parse(
      await (await call("/api/reviews?page_size=100", cookie)).json()
    )
    expect(list.items.find((item) => item.id === reviewId)).toEqual(row)
    const current = reviewDetailSchema.parse(
      await (await call(`/api/reviews/${reviewId}`, cookie)).json()
    )
    expect(current).toEqual(detail)
  }

  it("answers draft save, verify, publish and delete with the row and detail", async () => {
    const { owner, reviewId } = await createFixture()

    const saved = await call(`/api/reviews/${reviewId}/drafts`, owner.cookie, {
      method: "POST",
      body: { tone: "warm_professional", body: "Thank you for visiting us." },
    })
    expect(saved.status).toBe(201)
    const draft = (await saved.json()) as {
      draftId: string
      row?: unknown
      detail?: unknown
    }
    await expectCurrentSnapshot(draft, reviewId, owner.cookie, "verified")

    const verified = await call(
      `/api/drafts/${draft.draftId}/verify`,
      owner.cookie,
      { method: "POST" }
    )
    expect(verified.status).toBe(200)
    await expectCurrentSnapshot(
      await verified.json(),
      reviewId,
      owner.cookie,
      "verified"
    )

    const { review } = reviewDetailSchema.parse(draft.detail)
    const published = await call(
      `/api/reviews/${reviewId}/publish`,
      owner.cookie,
      {
        method: "POST",
        body: {
          draftId: draft.draftId,
          expectedReviewUpdateTime: review.updateTime,
        },
      }
    )
    expect(published.status).toBe(200)
    const publishBody = (await published.json()) as {
      status: string
      row?: unknown
      detail?: unknown
    }
    expect(publishBody.status).toBe("published")
    await expectCurrentSnapshot(
      publishBody,
      reviewId,
      owner.cookie,
      "published"
    )

    const deleted = await call(`/api/reviews/${reviewId}/reply`, owner.cookie, {
      method: "DELETE",
    })
    expect(deleted.status).toBe(200)
    const deleteBody = (await deleted.json()) as {
      row?: { workflowStatus: string }
    }
    await expectCurrentSnapshot(
      deleteBody,
      reviewId,
      owner.cookie,
      deleteBody.row!.workflowStatus
    )
    expect(deleteBody.row!.workflowStatus).not.toBe("published")
  })

  it("answers a parked publish and its approval with the row and detail", async () => {
    const { owner, reviewId } = await createFixture()
    const requester = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      canPublish: false,
    })
    const draft = await saveHumanDraft(
      server.baseUrl,
      owner.cookie,
      reviewId,
      "Thank you for sharing your experience."
    )

    const parked = await call(
      `/api/reviews/${reviewId}/publish`,
      requester.cookie,
      {
        method: "POST",
        body: draft,
      }
    )
    expect(parked.status).toBe(202)
    await expectCurrentSnapshot(
      await parked.json(),
      reviewId,
      requester.cookie,
      "awaiting_approval"
    )

    const approved = await call(
      `/api/reviews/${reviewId}/approval`,
      owner.cookie,
      {
        method: "POST",
        body: { decision: "approve", ...draft },
      }
    )
    expect(approved.status).toBe(200)
    await expectCurrentSnapshot(
      await approved.json(),
      reviewId,
      owner.cookie,
      "published"
    )
  })
})
