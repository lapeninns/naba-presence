import { randomUUID } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startAppServer } from "../helpers/app-server"
import { startAuthProviderStub } from "../helpers/auth-provider"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
const PASSWORD = "Pilot test password!42"

describeDatabase("invitation-only pilot admission", () => {
  let admin: ReturnType<typeof postgres>
  let auth: Awaited<ReturnType<typeof startAuthProviderStub>>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  const emails: string[] = []
  const newEmail = () => {
    const value = `pilot-${randomUUID()}@nabapresence.test`
    emails.push(value)
    return value
  }
  const post = (path: string, body: unknown, cookie?: string) =>
    fetch(server.baseUrl + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    })
  const register = (email: string, inviteToken?: string) =>
    post("/api/auth/password/register", {
      email,
      password: PASSWORD,
      displayName: "Pilot tester",
      inviteToken,
    })
  async function invite(email: string) {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const response = await post(
      "/api/invitations",
      { email, role: "member", canPublish: false },
      owner.cookie
    )
    expect(response.status).toBe(201)
    const body = await response.json()
    return { owner, token: new URL(body.inviteUrl).pathname.split("/").at(-1)! }
  }
  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    auth = await startAuthProviderStub()
    server = await startAppServer({
      PASSWORD_AUTH_ENABLED: "true",
      REGISTRATION_MODE: "invite_only",
      SUPABASE_URL: auth.baseUrl,
      SUPABASE_PUBLISHABLE_KEY: "stub-publishable-key",
    })
  })
  afterAll(async () => {
    await server.stop()
    await auth.stop()
    await destroyTenants(admin, organisations)
    if (emails.length)
      await admin`delete from app_user where email in ${admin(emails)}`
    await admin.end()
  })
  it("refuses uninvited signup before creating an auth identity or sending confirmation", async () => {
    const email = newEmail()
    const response = await register(email)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: "registration_closed",
    })
    expect(auth.users.has(email)).toBe(false)
  })
  it("refuses unknown, expired, consumed and wrong-address invitations before provider signup", async () => {
    const email = newEmail()
    expect((await register(email, "unknown-invitation-token")).status).toBe(410)
    const invitation = await invite(email)
    const other = newEmail()
    expect((await register(other, invitation.token)).status).toBe(403)
    await admin`update invitation set expires_at = now() - interval '1 minute' where email = ${email}`
    expect((await register(email, invitation.token)).status).toBe(410)
    await admin`update invitation set expires_at = now() + interval '1 hour', accepted_at = now() where email = ${email}`
    expect((await register(email, invitation.token)).status).toBe(409)
    expect(auth.users.has(email)).toBe(false)
    expect(auth.users.has(other)).toBe(false)
  })
  it("accepts an invited confirmed tester into only the invited organisation and supports later sign-in and recovery", async () => {
    const email = newEmail()
    const invitation = await invite(email)
    expect((await register(email, invitation.token)).status).toBe(202)
    const tokenHash = auth.confirmationToken(email)!
    const confirm = await fetch(
      `${server.baseUrl}/auth/confirm?flow=signup&type=email&token_hash=${tokenHash}&inviteToken=${invitation.token}`,
      { redirect: "manual" }
    )
    expect(confirm.status).toBe(307)
    expect(confirm.headers.get("location")).toContain("/inbox")
    const cookie = confirm.headers.get("set-cookie")!.split(";")[0]
    const session = await (
      await fetch(server.baseUrl + "/api/session", { headers: { cookie } })
    ).json()
    expect(session.session).toMatchObject({
      organisationId: invitation.owner.organisationId,
      role: "member",
      canPublish: false,
    })
    expect(
      (await post("/api/auth/password/login", { email, password: PASSWORD }))
        .status
    ).toBe(200)
    expect(
      (await post("/api/auth/password/reset/request", { email })).status
    ).toBe(202)
    expect(
      (
        await post("/api/auth/password/reset/complete", {
          tokenHash: auth.recoveryToken(email),
          password: "Recovered pilot password!84",
        })
      ).status
    ).toBe(200)
  })
  it("blocks a provider-created identity from provisioning an uninvited workspace via login or recovery", async () => {
    const email = newEmail()
    auth.addUser({ id: randomUUID(), email, password: PASSWORD })
    const login = await post("/api/auth/password/login", {
      email,
      password: PASSWORD,
    })
    expect(login.status).toBe(403)
    expect(await login.json()).toMatchObject({ error: "registration_closed" })
    await post("/api/auth/password/reset/request", { email })
    const reset = await post("/api/auth/password/reset/complete", {
      tokenHash: auth.recoveryToken(email),
      password: "Another valid password!84",
    })
    expect(reset.status).toBe(403)
    const [counts] =
      await admin`select count(*)::int as users from app_user where email = ${email}`
    expect(counts.users).toBe(0)
  })
  it("keeps existing members able to sign in without an invitation", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    auth.addUser({ id: randomUUID(), email: owner.email, password: PASSWORD })
    const response = await post("/api/auth/password/login", {
      email: owner.email,
      password: PASSWORD,
    })
    expect(response.status).toBe(200)
  })
  it("repairs an existing member's missing default workspace without opening registration", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    await admin`update app_user set default_organisation_id = null where id = ${owner.userId}`
    auth.addUser({ id: randomUUID(), email: owner.email, password: PASSWORD })
    const response = await post("/api/auth/password/login", {
      email: owner.email,
      password: PASSWORD,
    })
    expect(response.status).toBe(200)
    const cookie = response.headers.get("set-cookie")!.split(";")[0]
    const session = await (
      await fetch(server.baseUrl + "/api/session", { headers: { cookie } })
    ).json()
    expect(session.session.organisationId).toBe(owner.organisationId)
  })
  it("hides public creation even when the visitor requests create-account mode", async () => {
    const response = await fetch(
      server.baseUrl + "/sign-in?mode=create-account"
    )
    const html = await response.text()
    expect(html).toContain(
      "NabaPresence is available by invitation during the pilot."
    )
    expect(html).not.toContain('aria-label="Switch to create account"')
    expect(html).not.toContain('name="displayName"')
  })
})
