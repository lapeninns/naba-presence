import { randomBytes, randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { sha256 } from "@/lib/server/crypto"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const emptyCounts = {
  new: 0,
  drafted: 0,
  verified: 0,
  awaiting_approval: 0,
  publish_requested: 0,
  published: 0,
  rejected: 0,
  failed: 0,
}

describeDatabase("review queue counts", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  let organisationId: string
  let ownerCookie: string
  let memberCookie: string
  let viewerCookie: string

  async function seedUniqueReview(sequence: number) {
    const review = await seedReview(admin, { organisationId })
    await admin`
      update location
      set name = ${`Counts location ${sequence}`}
      where id = ${review.locationId}
    `
    return review
  }

  async function createActor(role: "member" | "viewer") {
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
        ${`counts-${userId.slice(0, 8)}@nabapresence.test`},
        'Counts actor',
        ${organisationId}
      )
    `
    await admin`
      insert into member (organisation_id, user_id, role, can_publish)
      values (${organisationId}, ${userId}, ${role}, false)
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

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    const owner = await createTestTenant(admin)
    organisationId = owner.organisationId
    ownerCookie = owner.cookie

    const first = await seedUniqueReview(1)
    const second = await seedUniqueReview(2)
    const third = await seedUniqueReview(3)
    const tombstoned = await seedUniqueReview(4)
    await admin`
      update review
      set workflow_status = 'drafted'
      where id = ${second.reviewId}
    `
    await admin`
      update review
      set workflow_status = 'published'
      where id = ${third.reviewId}
    `
    await admin`
      update review
      set provider_deleted_at = now()
      where id = ${tombstoned.reviewId}
    `

    const scopedMember = await createActor("member")
    const viewer = await createActor("viewer")
    memberCookie = scopedMember.cookie
    viewerCookie = viewer.cookie
    const inaccessibleLocationId = randomUUID()
    await admin`
      insert into location (id, organisation_id, name)
      values (
        ${inaccessibleLocationId},
        ${organisationId},
        'Counts-only member location'
      )
    `
    await admin`
      insert into location_member (
        organisation_id,
        location_id,
        user_id,
        can_publish
      )
      values (
        ${organisationId},
        ${inaccessibleLocationId},
        ${scopedMember.userId},
        false
      )
    `

    expect(first.reviewId).toBeTruthy()
    server = await startAppServer()
  })

  afterAll(async () => {
    await server?.stop()
    if (organisationId) await destroyTenants(admin, [organisationId])
    await admin?.end()
  })

  it("returns complete workflow totals and excludes tombstones", async () => {
    const response = await fetch(`${server.baseUrl}/api/reviews/counts`, {
      headers: { cookie: ownerCookie },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      total: 3,
      byStatus: {
        ...emptyCounts,
        new: 1,
        drafted: 1,
        published: 1,
      },
    })
  })

  it("scopes members with location grants to those locations", async () => {
    const response = await fetch(`${server.baseUrl}/api/reviews/counts`, {
      headers: { cookie: memberCookie },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      total: 0,
      byStatus: emptyCounts,
    })
  })

  it("allows viewer sessions to read counts", async () => {
    const response = await fetch(`${server.baseUrl}/api/reviews/counts`, {
      headers: { cookie: viewerCookie },
    })
    expect(response.status).toBe(200)
    expect((await response.json()).total).toBe(3)
  })

  it("requires a session", async () => {
    const response = await fetch(`${server.baseUrl}/api/reviews/counts`)
    expect(response.status).toBe(401)
  })
})
