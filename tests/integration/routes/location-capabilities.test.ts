import { randomBytes, randomUUID, createHash } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

// Seed an extra user with a given role in an existing org, returning a cookie.
async function seedMemberUser(
  admin: ReturnType<typeof postgres>,
  organisationId: string,
  role: "owner" | "admin" | "member" | "viewer",
  canPublish: boolean
) {
  const userId = randomUUID()
  const token = randomBytes(32).toString("base64url")
  await admin`
    insert into app_user (id, email, display_name, default_organisation_id)
    values (${userId}, ${`cap-${userId.slice(0, 8)}@nabapresence.test`}, 'Cap user', ${organisationId})
  `
  await admin`
    insert into member (organisation_id, user_id, role, can_publish)
    values (${organisationId}, ${userId}, ${role}, ${canPublish})
  `
  await admin`
    insert into app_session (token_hash, user_id, organisation_id, expires_at)
    values (${hashToken(token)}, ${userId}, ${organisationId}, now() + interval '1 hour')
  `
  return { userId, cookie: `naba_session=${token}` }
}

describeDatabase("per-location capabilities route", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  async function caps(cookie: string, locationId: string) {
    const response = await fetch(
      `${server.baseUrl}/api/locations/${locationId}/capabilities`,
      { headers: { cookie } }
    )
    expect(response.status).toBe(200)
    return (await response.json()) as {
      capabilities: {
        canEditCanonical: boolean
        canPublish: boolean
        resources: Record<string, { state: string; reasonCode?: string }>
      }
    }
  }

  function expectCaps(
    actual: {
      canEditCanonical: boolean
      canPublish: boolean
      resources: Record<string, { state: string; reasonCode?: string }>
    },
    expected: { canEditCanonical: boolean; canPublish: boolean }
  ) {
    expect(actual).toMatchObject(expected)
    expect(actual.resources).toBeTypeOf("object")
    expect(Object.keys(actual.resources).length).toBeGreaterThan(0)
  }

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    server = await startAppServer()
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("owner and admin can edit canonical and publish", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: tenant.organisationId })
    const location = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const admin2 = await seedMemberUser(admin, tenant.organisationId, "admin", false)

    expectCaps((await caps(tenant.cookie, location.locationId)).capabilities, {
      canEditCanonical: true,
      canPublish: true,
    })
    expectCaps((await caps(admin2.cookie, location.locationId)).capabilities, {
      canEditCanonical: true,
      canPublish: true,
    })
  })

  it("viewer can neither edit canonical nor publish", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: tenant.organisationId })
    const location = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const viewer = await seedMemberUser(admin, tenant.organisationId, "viewer", false)
    expectCaps((await caps(viewer.cookie, location.locationId)).capabilities, {
      canEditCanonical: false,
      canPublish: false,
    })
  })

  it("member with no assignments falls back to session.canPublish, never edits canonical", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: tenant.organisationId })
    const location = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const canPub = await seedMemberUser(admin, tenant.organisationId, "member", true)
    const noPub = await seedMemberUser(admin, tenant.organisationId, "member", false)
    expectCaps((await caps(canPub.cookie, location.locationId)).capabilities, {
      canEditCanonical: false,
      canPublish: true,
    })
    expectCaps((await caps(noPub.cookie, location.locationId)).capabilities, {
      canEditCanonical: false,
      canPublish: false,
    })
  })

  it("member with assignments: only the assigned location with can_publish publishes", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: tenant.organisationId })
    const assignedPublish = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const assignedNoPublish = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const unassigned = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    // session.canPublish = true, but assignments override it per-location.
    const member = await seedMemberUser(admin, tenant.organisationId, "member", true)
    await admin`
      insert into location_member (organisation_id, location_id, user_id, can_publish)
      values (${tenant.organisationId}, ${assignedPublish.locationId}, ${member.userId}, true)
    `
    await admin`
      insert into location_member (organisation_id, location_id, user_id, can_publish)
      values (${tenant.organisationId}, ${assignedNoPublish.locationId}, ${member.userId}, false)
    `
    // assigned + can_publish
    expectCaps((await caps(member.cookie, assignedPublish.locationId)).capabilities, {
      canEditCanonical: false,
      canPublish: true,
    })
    // assigned, no can_publish
    expectCaps((await caps(member.cookie, assignedNoPublish.locationId)).capabilities, {
      canEditCanonical: false,
      canPublish: false,
    })
    // has assignments but not to this location -> no publish
    expectCaps((await caps(member.cookie, unassigned.locationId)).capabilities, {
      canEditCanonical: false,
      canPublish: false,
    })
  })
})
