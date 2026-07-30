import { randomBytes, randomUUID } from "node:crypto"

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

describeDatabase("privacy-safe API serialization", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  let organisationId: string
  let ownerCookie: string
  let viewerCookie: string
  let reviewId: string
  let googleAccountName: string

  async function createViewer() {
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
        ${`serialization-${userId.slice(0, 8)}@nabapresence.test`},
        'Serialization viewer',
        ${organisationId}
      )
    `
    await admin`
      insert into member (organisation_id, user_id, role, can_publish)
      values (${organisationId}, ${userId}, 'viewer', false)
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
    return `naba_session=${token}`
  }

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, {
      max: 1,
      prepare: false,
    })
    stub = await startGoogleStub()
    const owner = await createTestTenant(admin)
    organisationId = owner.organisationId
    ownerCookie = owner.cookie
    viewerCookie = await createViewer()
    const connection = await seedGoogleConnection(admin, { organisationId })
    googleAccountName = connection.googleAccountName
    const review = await seedLinkedReview(admin, {
      organisationId,
      connectionId: connection.connectionId,
      googleAccountName,
    })
    reviewId = review.reviewId
    await admin`
      insert into audit_log (
        organisation_id,
        actor_user_id,
        action,
        subject_type,
        subject_id,
        request_id,
        metadata
      )
      values (
        ${organisationId},
        ${owner.userId},
        'review.serialization.fixture',
        'review',
        ${reviewId},
        ${randomUUID()},
        ${admin.json({
          status: "published",
          reviewerEmail: "private@example.test",
        })}
      )
    `
    stub.respond(
      { method: "GET", pathIncludes: "/locations?" },
      () => ({
        status: 200,
        json: {
          locations: [
            {
              name: "locations/camden-serialization",
              title: "Camden Hotel",
              storefrontAddress: {
                addressLines: ["10 Camden High Street"],
                locality: "London",
                administrativeArea: "England",
                postalCode: "NW1 0JH",
                regionCode: "GB",
              },
              phoneNumbers: {
                primaryPhone: "+44 20 7946 0123",
              },
              latlng: { latitude: 51.54, longitude: -0.14 },
              metadata: { hasVoiceOfMerchant: true },
            },
          ],
        },
      })
    )
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
    })
  })

  afterAll(async () => {
    await server?.stop()
    await stub?.stop()
    if (organisationId) await destroyTenants(admin, [organisationId])
    await admin?.end()
  })

  it("does not serialize provider review identifiers", async () => {
    const [inboxResponse, detailResponse] = await Promise.all([
      fetch(`${server.baseUrl}/api/reviews`, {
        headers: { cookie: ownerCookie },
      }),
      fetch(`${server.baseUrl}/api/reviews/${reviewId}`, {
        headers: { cookie: ownerCookie },
      }),
    ])
    expect(inboxResponse.status).toBe(200)
    expect(detailResponse.status).toBe(200)
    for (const payload of [
      await inboxResponse.json(),
      await detailResponse.json(),
    ]) {
      const serialized = JSON.stringify(payload)
      expect(serialized).not.toContain("googleReviewName")
      expect(serialized).not.toContain("googleReviewId")
    }
  })

  it("summarizes timeline metadata without returning raw audit JSON", async () => {
    const response = await fetch(
      `${server.baseUrl}/api/reviews/${reviewId}`,
      { headers: { cookie: ownerCookie } }
    )
    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      review: {
        timeline: Array<Record<string, unknown>>
      }
    }
    const event = payload.review.timeline.find(
      (item) => item.action === "review.serialization.fixture"
    )
    expect(event).toEqual({
      action: "review.serialization.fixture",
      actorName: "Harness user",
      createdAt: expect.any(String),
      metadataSummary: expect.any(String),
    })
    expect(JSON.stringify(event)).not.toContain("private@example.test")
  })

  it("allowlists the Google location discovery response", async () => {
    const response = await fetch(`${server.baseUrl}/api/google/locations`, {
      headers: { cookie: ownerCookie },
    })
    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      locations: Array<Record<string, unknown>>
    }
    expect(payload.locations).toHaveLength(1)
    expect(payload.locations[0]).toEqual({
      id: expect.any(String),
      accountName: googleAccountName,
      googleLocationName: "locations/camden-serialization",
      title: "Camden Hotel",
      address: "10 Camden High Street, London, England, NW1 0JH",
      verified: true,
    })
  })

  it("masks connection details for viewers but not owners", async () => {
    const [viewerResponse, ownerResponse] = await Promise.all([
      fetch(`${server.baseUrl}/api/google/connections`, {
        headers: { cookie: viewerCookie },
      }),
      fetch(`${server.baseUrl}/api/google/connections`, {
        headers: { cookie: ownerCookie },
      }),
    ])
    expect(viewerResponse.status).toBe(200)
    expect(ownerResponse.status).toBe(200)
    const viewerConnection = (await viewerResponse.json()).connections[0]
    const ownerConnection = (await ownerResponse.json()).connections[0]
    expect(viewerConnection.googleEmail).toMatch(/^.\*{3}@/)
    expect(viewerConnection).not.toHaveProperty("scope")
    expect(ownerConnection.googleEmail).toBe("stub@example.test")
    expect(ownerConnection.scope).toBe("business.manage")
  })
})
