import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { sha256 } from "@/lib/server/crypto"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedLinkedReview,
  seedGoogleConnection,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

// Seeds a draft + its verification_result directly (bypassing the
// /drafts generate endpoint and its DRAFTS_ENABLED flag/AI dependency) so
// the latestVerification assertion below is deterministic regardless of
// harness configuration.
async function seedVerifiedDraft(
  admin: ReturnType<typeof postgres>,
  input: {
    organisationId: string
    reviewId: string
    verdict: "pass" | "warn" | "fail"
    reasons: { code: string; severity: string; message: string }[]
  }
) {
  const draftId = randomUUID()
  const body = "Please email us at team@example.com."
  await admin`
    insert into draft (
      id, organisation_id, review_id, source, body, body_bytes,
      evidence_hash, verification_status, created_at
    ) values (
      ${draftId}, ${input.organisationId}, ${input.reviewId}, 'human',
      ${body}, ${Buffer.byteLength(body, "utf8")},
      ${sha256(body)}, ${input.verdict}, now()
    )
  `
  await admin`
    insert into verification_result (
      organisation_id, draft_id, verdict, reasons, checks_version, created_at
    ) values (
      ${input.organisationId}, ${draftId}, ${input.verdict},
      ${admin.json(input.reasons)}, 'v1-test', now()
    )
  `
  return { draftId }
}

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
      items: {
        id: string
        capabilities: {
          canPublish: boolean
          canEdit: boolean
          canRequestApproval: boolean
        }
      }[]
    }
    const listed = listBody.items.find((item) => item.id === review.reviewId)
    expect(listed?.capabilities).toEqual({
      canPublish: true,
      canEdit: true,
      canRequestApproval: false,
    })

    const detail = await fetch(
      `${server.baseUrl}/api/reviews/${review.reviewId}`,
      { headers: { cookie: tenant.cookie } }
    )
    expect(detail.status).toBe(200)
    const detailBody = (await detail.json()) as {
      review: {
        capabilities: {
          canPublish: boolean
          canEdit: boolean
          canRequestApproval: boolean
        }
      }
    }
    expect(detailBody.review.capabilities).toEqual({
      canPublish: true,
      canEdit: true,
      canRequestApproval: false,
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
      items: {
        id: string
        capabilities: {
          canPublish: boolean
          canEdit: boolean
          canRequestApproval: boolean
        }
      }[]
    }
    const listed = body.items.find((item) => item.id === review.reviewId)
    expect(listed?.capabilities).toEqual({
      canPublish: false,
      canEdit: false,
      canRequestApproval: false,
    })
  })

  it("member ASSIGNED to the review's location with can_publish=false sees canPublish false, canEdit true", async () => {
    const tenant = await createTestTenant(admin, {
      role: "member",
      canPublish: true, // org-wide fallback must NOT win once assigned
    })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const review = await seedLinkedReview(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      text: "Member assigned review",
      rating: 4,
    })
    await admin`
      insert into location_member (
        organisation_id, location_id, user_id, can_publish
      ) values (
        ${tenant.organisationId}, ${review.locationId}, ${tenant.userId}, false
      )
    `

    const list = await fetch(`${server.baseUrl}/api/reviews`, {
      headers: { cookie: tenant.cookie },
    })
    expect(list.status).toBe(200)
    const listBody = (await list.json()) as {
      items: {
        id: string
        capabilities: {
          canPublish: boolean
          canEdit: boolean
          canRequestApproval: boolean
        }
      }[]
    }
    const listed = listBody.items.find((item) => item.id === review.reviewId)
    // organisation.approval_required defaults to true (see
    // supabase/migrations/0001_initial.sql) and this tenant never overrides
    // it, so a non-publishing-but-editing member can request approval.
    expect(listed?.capabilities).toEqual({
      canPublish: false,
      canEdit: true,
      canRequestApproval: true,
    })

    const detail = await fetch(
      `${server.baseUrl}/api/reviews/${review.reviewId}`,
      { headers: { cookie: tenant.cookie } }
    )
    expect(detail.status).toBe(200)
    const detailBody = (await detail.json()) as {
      review: {
        capabilities: {
          canPublish: boolean
          canEdit: boolean
          canRequestApproval: boolean
        }
      }
    }
    expect(detailBody.review.capabilities).toEqual({
      canPublish: false,
      canEdit: true,
      canRequestApproval: true,
    })
  })

  it("a non-publishing member can request approval only when the org requires approval", async () => {
    const tenant = await createTestTenant(admin, {
      role: "member",
      canPublish: true, // org-wide fallback must NOT win once assigned
    })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const review = await seedLinkedReview(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      text: "Approval-required toggle review",
      rating: 4,
    })
    await admin`
      insert into location_member (
        organisation_id, location_id, user_id, can_publish
      ) values (
        ${tenant.organisationId}, ${review.locationId}, ${tenant.userId}, false
      )
    `

    // organisation.approval_required defaults to true.
    const withApproval = await fetch(
      `${server.baseUrl}/api/reviews/${review.reviewId}`,
      { headers: { cookie: tenant.cookie } }
    )
    expect(withApproval.status).toBe(200)
    const withApprovalBody = (await withApproval.json()) as {
      review: {
        capabilities: {
          canPublish: boolean
          canEdit: boolean
          canRequestApproval: boolean
        }
      }
    }
    expect(withApprovalBody.review.capabilities).toEqual({
      canPublish: false,
      canEdit: true,
      canRequestApproval: true,
    })

    await admin`
      update organisation
      set approval_required = false
      where id = ${tenant.organisationId}
    `

    const withoutApproval = await fetch(
      `${server.baseUrl}/api/reviews/${review.reviewId}`,
      { headers: { cookie: tenant.cookie } }
    )
    expect(withoutApproval.status).toBe(200)
    const withoutApprovalBody = (await withoutApproval.json()) as {
      review: {
        capabilities: {
          canPublish: boolean
          canEdit: boolean
          canRequestApproval: boolean
        }
      }
    }
    expect(withoutApprovalBody.review.capabilities).toEqual({
      canPublish: false,
      canEdit: true,
      canRequestApproval: false,
    })
  })

  it("member with assignments elsewhere cannot see or access a review at an unassigned location", async () => {
    const tenant = await createTestTenant(admin, {
      role: "member",
      canPublish: true,
    })
    organisations.push(tenant.organisationId)

    // A location the member IS assigned to -- this makes hasAssignments
    // true for the member, which is the precondition for the
    // "assigned elsewhere" branch under test.
    const assignedConnection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const assignedReview = await seedLinkedReview(admin, {
      organisationId: tenant.organisationId,
      connectionId: assignedConnection.connectionId,
      googleAccountName: assignedConnection.googleAccountName,
      text: "Assigned-elsewhere review",
      rating: 5,
    })
    await admin`
      insert into location_member (
        organisation_id, location_id, user_id, can_publish
      ) values (
        ${tenant.organisationId}, ${assignedReview.locationId},
        ${tenant.userId}, true
      )
    `

    // A second, unrelated location the member has no location_member row
    // for at all.
    const otherConnection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const unassignedReview = await seedLinkedReview(admin, {
      organisationId: tenant.organisationId,
      connectionId: otherConnection.connectionId,
      googleAccountName: otherConnection.googleAccountName,
      text: "Unassigned-location review",
      rating: 2,
    })

    const list = await fetch(`${server.baseUrl}/api/reviews`, {
      headers: { cookie: tenant.cookie },
    })
    expect(list.status).toBe(200)
    const listBody = (await list.json()) as { items: { id: string }[] }
    expect(
      listBody.items.some((item) => item.id === assignedReview.reviewId)
    ).toBe(true)
    expect(
      listBody.items.some((item) => item.id === unassignedReview.reviewId)
    ).toBe(false)

    const detail = await fetch(
      `${server.baseUrl}/api/reviews/${unassignedReview.reviewId}`,
      { headers: { cookie: tenant.cookie } }
    )
    expect(detail.status).toBe(404)
  })

  it.each([true, false])(
    "member with NO location assignments falls back to session.canPublish=%s",
    async (canPublish) => {
      const tenant = await createTestTenant(admin, {
        role: "member",
        canPublish,
      })
      organisations.push(tenant.organisationId)
      const connection = await seedGoogleConnection(admin, {
        organisationId: tenant.organisationId,
      })
      const review = await seedLinkedReview(admin, {
        organisationId: tenant.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
        text: "Org-wide fallback review",
        rating: 3,
      })

      const detail = await fetch(
        `${server.baseUrl}/api/reviews/${review.reviewId}`,
        { headers: { cookie: tenant.cookie } }
      )
      expect(detail.status).toBe(200)
      const detailBody = (await detail.json()) as {
        review: {
          capabilities: {
            canPublish: boolean
            canEdit: boolean
            canRequestApproval: boolean
          }
        }
      }
      // organisation.approval_required defaults to true here, so
      // canRequestApproval mirrors !canPublish for this unassigned member.
      expect(detailBody.review.capabilities).toEqual({
        canPublish,
        canEdit: true,
        canRequestApproval: !canPublish,
      })
    }
  )

  it("detail carries latestVerification with reasons, seeded deterministically (independent of DRAFTS_ENABLED)", async () => {
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
    await seedVerifiedDraft(admin, {
      organisationId: tenant.organisationId,
      reviewId: review.reviewId,
      verdict: "fail",
      reasons: [
        {
          code: "personal_contact_data",
          severity: "fail",
          message: "Draft contains an email address.",
        },
      ],
    })

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
