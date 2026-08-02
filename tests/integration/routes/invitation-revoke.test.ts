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
  role: "admin" | "member" | "viewer"
) {
  const userId = randomUUID()
  const token = randomBytes(32).toString("base64url")
  await admin`
    insert into app_user (id, email, display_name, default_organisation_id)
    values (${userId}, ${`rev-${userId.slice(0, 8)}@nabapresence.test`}, 'Rev user', ${organisationId})
  `
  await admin`
    insert into member (organisation_id, user_id, role, can_publish)
    values (${organisationId}, ${userId}, ${role}, false)
  `
  await admin`
    insert into app_session (token_hash, user_id, organisation_id, expires_at)
    values (${hashToken(token)}, ${userId}, ${organisationId}, now() + interval '1 hour')
  `
  return { userId, cookie: `naba_session=${token}` }
}

describeDatabase("invitation revoke route", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  async function createInvitation(cookie: string, email: string) {
    const response = await fetch(`${server.baseUrl}/api/invitations`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ email, role: "member", canPublish: false }),
    })
    expect(response.status).toBe(201)
    return ((await response.json()) as { invitation: { id: string } }).invitation
  }

  async function revoke(cookie: string, id: string) {
    return fetch(`${server.baseUrl}/api/invitations/${id}`, {
      method: "DELETE",
      headers: { cookie },
    })
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

  it("an owner revokes a pending invitation and a second revoke 404s", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const invitation = await createInvitation(tenant.cookie, "revoke-me@nabapresence.test")

    const first = await revoke(tenant.cookie, invitation.id)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ revoked: true })

    const second = await revoke(tenant.cookie, invitation.id)
    expect(second.status).toBe(404)
    expect(((await second.json()) as { error: string }).error).toBe("invitation_not_found")
  })

  it("an admin may revoke; a member and a viewer may not", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const adminUser = await seedMemberUser(admin, tenant.organisationId, "admin")
    const member = await seedMemberUser(admin, tenant.organisationId, "member")
    const viewer = await seedMemberUser(admin, tenant.organisationId, "viewer")

    const adminInvite = await createInvitation(tenant.cookie, "admin-can@nabapresence.test")
    expect((await revoke(adminUser.cookie, adminInvite.id)).status).toBe(200)

    const guarded = await createInvitation(tenant.cookie, "guarded@nabapresence.test")
    expect((await revoke(member.cookie, guarded.id)).status).toBe(403)
    expect((await revoke(viewer.cookie, guarded.id)).status).toBe(403)
    // Still revocable by the owner afterwards (the guarded attempts changed nothing).
    expect((await revoke(tenant.cookie, guarded.id)).status).toBe(200)
  })

  it("cannot revoke an invitation from another organisation (404)", async () => {
    const orgA = await createTestTenant(admin, { role: "owner" })
    organisations.push(orgA.organisationId)
    const orgB = await createTestTenant(admin, { role: "owner" })
    organisations.push(orgB.organisationId)
    const inviteB = await createInvitation(orgB.cookie, "cross@nabapresence.test")

    const res = await revoke(orgA.cookie, inviteB.id) // orgA tries to revoke orgB's invite
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toBe("invitation_not_found")
  })

  it("rejects a non-uuid invitation id (400 invalid_request)", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const res = await revoke(tenant.cookie, "not-a-uuid")
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe("invalid_request")
  })
})
