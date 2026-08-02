import { randomBytes, randomUUID, createHash } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

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

describeDatabase("settings capabilities route", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  async function caps(cookie: string) {
    const response = await fetch(`${server.baseUrl}/api/settings/capabilities`, {
      headers: { cookie },
    })
    expect(response.status).toBe(200)
    return (await response.json()) as {
      capabilities: {
        canManageTeam: boolean
        canManageConnections: boolean
        canEditSettings: boolean
        canViewCompliance: boolean
        canManageCompliance: boolean
      }
    }
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

  it("owner can manage everything including compliance", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    expect((await caps(tenant.cookie)).capabilities).toEqual({
      canManageTeam: true,
      canManageConnections: true,
      canEditSettings: true,
      canViewCompliance: true,
      canManageCompliance: true,
    })
  })

  it("admin manages team/connections/settings and views compliance but can't manage it", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const adminUser = await seedMemberUser(admin, tenant.organisationId, "admin", true)
    expect((await caps(adminUser.cookie)).capabilities).toEqual({
      canManageTeam: true,
      canManageConnections: true,
      canEditSettings: true,
      canViewCompliance: true,
      canManageCompliance: false,
    })
  })

  it("member and viewer manage nothing", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const member = await seedMemberUser(admin, tenant.organisationId, "member", true)
    const viewer = await seedMemberUser(admin, tenant.organisationId, "viewer", false)
    const allFalse = {
      canManageTeam: false,
      canManageConnections: false,
      canEditSettings: false,
      canViewCompliance: false,
      canManageCompliance: false,
    }
    expect((await caps(member.cookie)).capabilities).toEqual(allFalse)
    expect((await caps(viewer.cookie)).capabilities).toEqual(allFalse)
  })
})
