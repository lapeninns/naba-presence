import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("auth additions", () => {
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

  it("accepts a resend request without disclosing account existence", async () => {
    // PASSWORD_AUTH_ENABLED is false in this harness, so the provider is never
    // reached; the route must still validate input and refuse to leak.
    const response = await fetch(
      `${server.baseUrl}/api/auth/password/resend`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "nobody@nabapresence.test" }),
      }
    )
    expect([202, 503]).toContain(response.status)
    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain("not found")
  })

  it("rejects a malformed resend request", async () => {
    const response = await fetch(
      `${server.baseUrl}/api/auth/password/resend`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
      }
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe("invalid_request")
  })

  it("reports accepted invitations separately from expired ones", async () => {
    const tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    const token = "m2-accepted-invitation-token-value"
    const { createHash, randomBytes } = await import("node:crypto")
    const tokenHash = createHash("sha256").update(token).digest("hex")
    await admin`
      insert into invitation (
        organisation_id, email, role, token_hash, token_ciphertext,
        invited_by, expires_at, accepted_at
      )
      values (
        ${tenant.organisationId},
        'invited@nabapresence.test',
        'member',
        ${tokenHash},
        ${randomBytes(32)},
        ${tenant.userId},
        now() + interval '7 days',
        now()
      )
    `
    const response = await fetch(
      `${server.baseUrl}/api/invitations/${token}`
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.accepted).toBe(true)
    expect(body.expired).toBe(false)
  })
})
