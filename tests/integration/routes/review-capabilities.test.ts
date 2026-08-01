import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedLinkedReview,
  seedGoogleConnection,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("review capabilities on inbox responses", () => {
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

  it("owner sees canPublish and canEdit true on list and detail", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const review = await seedLinkedReview(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      text: "Capabilities owner review",
      rating: 5,
    })

    const list = await fetch(`${server.baseUrl}/api/reviews`, {
      headers: { cookie: tenant.cookie },
    })
    expect(list.status).toBe(200)
    const listBody = (await list.json()) as {
      items: { id: string; capabilities: { canPublish: boolean; canEdit: boolean } }[]
    }
    const listed = listBody.items.find((item) => item.id === review.reviewId)
    expect(listed?.capabilities).toEqual({ canPublish: true, canEdit: true })

    const detail = await fetch(
      `${server.baseUrl}/api/reviews/${review.reviewId}`,
      { headers: { cookie: tenant.cookie } }
    )
    expect(detail.status).toBe(200)
    const detailBody = (await detail.json()) as {
      review: { capabilities: { canPublish: boolean; canEdit: boolean } }
    }
    expect(detailBody.review.capabilities).toEqual({
      canPublish: true,
      canEdit: true,
    })
  })

  it("viewer sees canPublish and canEdit false", async () => {
    const tenant = await createTestTenant(admin, {
      role: "viewer",
      canPublish: false,
    })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const review = await seedLinkedReview(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      text: "Capabilities viewer review",
      rating: 3,
    })
    const list = await fetch(`${server.baseUrl}/api/reviews`, {
      headers: { cookie: tenant.cookie },
    })
    const body = (await list.json()) as {
      items: { id: string; capabilities: { canPublish: boolean; canEdit: boolean } }[]
    }
    const listed = body.items.find((item) => item.id === review.reviewId)
    expect(listed?.capabilities).toEqual({ canPublish: false, canEdit: false })
  })

  it("detail carries latestVerification with reasons for a drafted review", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const review = await seedLinkedReview(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      text: "Reasons detail review",
      rating: 4,
    })
    // A human draft containing an email deterministically fails verification
    // (personal_contact_data), so latestVerification carries a reason.
    const drafted = await fetch(
      `${server.baseUrl}/api/reviews/${review.reviewId}/drafts`,
      {
        method: "POST",
        headers: {
          cookie: tenant.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ body: "Please email us at team@example.com." }),
      }
    )
    expect([201, 503]).toContain(drafted.status)
    if (drafted.status === 503) return // DRAFTS_ENABLED off in this harness

    const detail = await fetch(
      `${server.baseUrl}/api/reviews/${review.reviewId}`,
      { headers: { cookie: tenant.cookie } }
    )
    expect(detail.status).toBe(200)
    const detailBody = (await detail.json()) as {
      review: {
        latestVerification: {
          verdict: string
          reasons: { code: string; severity: string; message: string }[]
        } | null
      }
    }
    expect(detailBody.review.latestVerification?.verdict).toBe("fail")
    expect(
      detailBody.review.latestVerification?.reasons.some(
        (reason) => reason.code === "personal_contact_data"
      )
    ).toBe(true)
  })
})
