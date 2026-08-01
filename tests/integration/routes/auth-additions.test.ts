import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  PROVIDER_ERROR_EMAIL,
  RATE_LIMITED_EMAIL,
  startAuthProviderStub,
} from "../helpers/auth-provider"
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

// The suite above runs with PASSWORD_AUTH_ENABLED=false (the harness
// default), so providerConfiguration() always throws before a Supabase call
// is even attempted - resendConfirmationEmail's and requestPasswordReset's
// provider-facing branches (429 mapping, silent non-429 swallow) are never
// exercised there. This block enables password auth against the GoTrue stub
// (mirroring exactly how password-auth.test.ts configures its app server)
// so those branches run for real.
describeDatabase("auth additions with a live provider", () => {
  let auth: Awaited<ReturnType<typeof startAuthProviderStub>>
  let server: Awaited<ReturnType<typeof startAppServer>>

  beforeAll(async () => {
    auth = await startAuthProviderStub()
    server = await startAppServer({
      PASSWORD_AUTH_ENABLED: "true",
      SUPABASE_URL: auth.baseUrl,
      SUPABASE_PUBLISHABLE_KEY: "stub-publishable-key",
    })
  })

  afterAll(async () => {
    await server.stop()
    await auth.stop()
  })

  it("resends a confirmation for a real registered account", async () => {
    auth.addUser({
      id: crypto.randomUUID(),
      email: "resend-success@nabapresence.test",
      password: "Correct horse!42",
      confirmed: false,
    })

    const response = await fetch(
      `${server.baseUrl}/api/auth/password/resend`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "resend-success@nabapresence.test" }),
      }
    )
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: true })
    expect(auth.resendRequests.at(-1)).toMatchObject({
      email: "resend-success@nabapresence.test",
    })
  })

  it("surfaces the provider's rate limit on resend", async () => {
    const response = await fetch(
      `${server.baseUrl}/api/auth/password/resend`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: RATE_LIMITED_EMAIL }),
      }
    )
    expect(response.status).toBe(429)
    expect((await response.json()).error).toBe("auth_rate_limited")
  })

  it("swallows a non-429 resend provider error without disclosing it", async () => {
    const response = await fetch(
      `${server.baseUrl}/api/auth/password/resend`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: PROVIDER_ERROR_EMAIL }),
      }
    )
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: true })
  })

  it("surfaces the provider's rate limit on a password reset request", async () => {
    const response = await fetch(
      `${server.baseUrl}/api/auth/password/reset/request`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: RATE_LIMITED_EMAIL }),
      }
    )
    expect(response.status).toBe(429)
    expect((await response.json()).error).toBe("auth_rate_limited")
  })

  it("swallows a non-429 reset-request provider error without disclosing it", async () => {
    const response = await fetch(
      `${server.baseUrl}/api/auth/password/reset/request`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: PROVIDER_ERROR_EMAIL }),
      }
    )
    expect(response.status).toBe(202)
    const body = await response.json()
    expect(body.accepted).toBe(true)
  })
})
