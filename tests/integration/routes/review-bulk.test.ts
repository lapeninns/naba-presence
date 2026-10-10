import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedMemberUser,
  seedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("bulk review actions", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    server = await startAppServer()
  })

  afterAll(async () => {
    await server.stop()
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
