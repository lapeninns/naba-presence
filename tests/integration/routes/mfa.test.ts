import { createHash, randomBytes, randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { STUB_TOTP_CODE, startAuthProviderStub } from "../helpers/auth-provider"
import { openConfirmationLink } from "../helpers/email-confirmation"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const PASSWORD = "Correct horse!42"

/**
 * The `name=value` pairs a response set, by cookie name. A deletion (empty
 * value) is not a cookie set.
 */
function setCookies(response: Response): Map<string, string> {
  const cookies = new Map<string, string>()
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(";")[0] ?? ""
    const name = pair.slice(0, pair.indexOf("="))
    if (pair.length > name.length + 1) cookies.set(name, pair)
  }
  return cookies
}

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex")

describeDatabase("two-step verification (P02-S8)", () => {
  let admin: ReturnType<typeof postgres>
  let auth: Awaited<ReturnType<typeof startAuthProviderStub>>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  const emails: string[] = []

  /**
   * An owner who enrolled and verified a code just now: inviting is a
   * sensitive action (P02-S9 step-up), so an aal1 owner would be refused.
   */
  async function steppedUpOwner() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const token = randomBytes(32).toString("base64url")
    await admin`update app_user set mfa_factor_count = 1 where id = ${owner.userId}`
    await admin`
      insert into app_session (
        token_hash, user_id, organisation_id, expires_at,
        aal, mfa_factor_id, mfa_verified_at, mfa_proof_expires_at,
        security_version, auth_method
      )
      select
        ${sha256(token)}, ${owner.userId}, ${owner.organisationId},
        now() + interval '1 hour', 'aal2', 'factor-1', now(),
        now() + interval '15 minutes', u.security_version, 'password'
      from app_user u where u.id = ${owner.userId}
    `
    return { ...owner, cookie: `naba_session=${token}` }
  }

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    auth = await startAuthProviderStub()
    server = await startAppServer({
      PASSWORD_AUTH_ENABLED: "true",
      MFA_ENABLED: "true",
      SUPABASE_URL: auth.baseUrl,
      SUPABASE_PUBLISHABLE_KEY: "stub-publishable-key",
    })
  })

  afterAll(async () => {
    await server.stop()
    await auth.stop()
    const owned = await admin<{ id: string }[]>`
      select distinct m.organisation_id::text as id
      from member m
      join app_user u on u.id = m.user_id
      where u.email in ${admin(emails.length > 0 ? emails : [""])}
        and m.role = 'owner'
    `
    await destroyTenants(admin, [
      ...organisations,
      ...owned.map((row) => row.id),
    ])
    if (emails.length > 0) {
      await admin`delete from app_user where email in ${admin(emails)}`
    }
    await admin.end()
  })

  function newUser(options: { enrolled?: boolean } = {}) {
    const email = `mfa-${randomUUID()}@nabapresence.test`
    emails.push(email)
    auth.addUser({ id: randomUUID(), email, password: PASSWORD })
    const factor = options.enrolled ? auth.addFactor(email) : null
    return { email, factor }
  }

  async function post(path: string, body: unknown, cookie?: string) {
    return fetch(`${server.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    })
  }

  async function login(email: string, extra: Record<string, unknown> = {}) {
    return post("/api/auth/password/login", {
      email,
      password: PASSWORD,
      ...extra,
    })
  }

  async function sessionOf(cookie: string) {
    const response = await fetch(`${server.baseUrl}/api/session`, {
      headers: { cookie },
    })
    return (await response.json()) as {
      session: {
        userId: string
        organisationId: string
        aal?: string
      } | null
    }
  }

  async function sessionRow(cookie: string) {
    const token = cookie.slice(cookie.indexOf("=") + 1)
    const { createHash } = await import("node:crypto")
    const hash = createHash("sha256").update(token).digest("hex")
    const [row] = await admin<
      {
        aal: string
        mfaFactorId: string | null
        mfaVerifiedAt: Date | null
        mfaProofExpiresAt: Date | null
        authMethod: string | null
        securityVersion: number
      }[]
    >`
      select
        aal,
        mfa_factor_id as "mfaFactorId",
        mfa_verified_at as "mfaVerifiedAt",
        mfa_proof_expires_at as "mfaProofExpiresAt",
        auth_method as "authMethod",
        security_version as "securityVersion"
      from app_session
      where token_hash = ${hash}
    `
    return row
  }

  /** Signs an enrolled person in with password + code; returns the cookie. */
  async function signInWithCode(email: string) {
    const first = await login(email)
    const ticket = setCookies(first).get("naba_mfa_ticket")!
    const verify = await post(
      "/api/auth/mfa/verify",
      { code: STUB_TOTP_CODE },
      ticket
    )
    expect(verify.status).toBe(200)
    return setCookies(verify).get("naba_session")!
  }

  it("leaves a sign-in without factors unchanged (aal1)", async () => {
    const { email } = newUser()
    const response = await login(email)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      authenticated: true,
      mfaRequired: false,
    })
    const cookies = setCookies(response)
    expect(cookies.has("naba_mfa_ticket")).toBe(false)
    const row = await sessionRow(cookies.get("naba_session")!)
    expect(row).toMatchObject({
      aal: "aal1",
      mfaFactorId: null,
      authMethod: "password",
      securityVersion: 1,
    })
  })

  it("gives an enrolled person a ticket, not a session, then an aal2 session for the code", async () => {
    const { email, factor } = newUser({ enrolled: true })
    const first = await login(email)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({
      authenticated: false,
      mfaRequired: true,
    })
    const cookies = setCookies(first)
    expect(cookies.has("naba_session")).toBe(false)
    const ticket = cookies.get("naba_mfa_ticket")
    expect(ticket).toBeTruthy()
    const [user] = await admin`select id from app_user where email = ${email}`
    expect(user).toBeUndefined()

    const factors = await fetch(`${server.baseUrl}/api/auth/mfa/factors`, {
      headers: { cookie: ticket! },
    })
    expect(factors.status).toBe(200)
    expect(await factors.json()).toMatchObject({
      factors: [{ id: factor!.id, friendlyName: factor!.friendlyName }],
    })

    const wrong = await post("/api/auth/mfa/verify", { code: "000000" }, ticket)
    expect(wrong.status).toBe(400)
    expect(await wrong.json()).toMatchObject({
      error: "mfa_code_invalid",
      details: { attemptsRemaining: 4 },
    })

    const verify = await post(
      "/api/auth/mfa/verify",
      { code: STUB_TOTP_CODE },
      ticket
    )
    expect(verify.status).toBe(200)
    expect(await verify.json()).toEqual({ verified: true, purpose: "sign_in" })
    const sessionCookie = setCookies(verify).get("naba_session")!
    const row = await sessionRow(sessionCookie)
    expect(row).toMatchObject({
      aal: "aal2",
      mfaFactorId: factor!.id,
      authMethod: "password",
    })
    expect(
      row.mfaProofExpiresAt!.getTime() - row.mfaVerifiedAt!.getTime()
    ).toBe(15 * 60 * 1000)
    const session = await sessionOf(sessionCookie)
    expect(session.session?.aal).toBe("aal2")
    const [count] = await admin<{ mfaFactorCount: number }[]>`
      select mfa_factor_count as "mfaFactorCount"
      from app_user where email = ${email}
    `
    expect(count.mfaFactorCount).toBe(1)

    // A spent ticket cannot mint a second session.
    const replay = await post(
      "/api/auth/mfa/verify",
      { code: STUB_TOTP_CODE },
      ticket
    )
    expect(replay.status).toBe(401)
    expect(await replay.json()).toMatchObject({ error: "mfa_ticket_invalid" })
  })

  it("ends a ticket after five wrong codes", async () => {
    const { email } = newUser({ enrolled: true })
    const ticket = setCookies(await login(email)).get("naba_mfa_ticket")!
    const statuses: number[] = []
    for (let index = 0; index < 5; index += 1) {
      statuses.push(
        (await post("/api/auth/mfa/verify", { code: "111111" }, ticket)).status
      )
    }
    expect(statuses).toEqual([400, 400, 400, 400, 401])
    const late = await post(
      "/api/auth/mfa/verify",
      { code: STUB_TOTP_CODE },
      ticket
    )
    expect(late.status).toBe(401)
  })

  it("refuses verify without a ticket and a factor the ticket does not list", async () => {
    const none = await post("/api/auth/mfa/verify", { code: STUB_TOTP_CODE })
    expect(none.status).toBe(401)
    const { email } = newUser({ enrolled: true })
    const ticket = setCookies(await login(email)).get("naba_mfa_ticket")!
    const foreign = await post(
      "/api/auth/mfa/verify",
      { code: STUB_TOTP_CODE, factorId: randomUUID() },
      ticket
    )
    expect(foreign.status).toBe(400)
    expect(await foreign.json()).toMatchObject({ error: "mfa_factor_unknown" })
  })

  it("sets an enrolled person's reset password only after the code", async () => {
    const { email } = newUser({ enrolled: true })
    const earlier = await signInWithCode(email)
    expect((await sessionOf(earlier)).session).not.toBeNull()
    const NEW_PASSWORD = "Brand new horse!43"

    await post("/api/auth/password/reset/request", { email })
    const reset = await post("/api/auth/password/reset/complete", {
      tokenHash: auth.recoveryToken(email),
      password: NEW_PASSWORD,
    })
    expect(reset.status).toBe(200)
    expect(await reset.json()).toEqual({
      updated: false,
      authenticated: false,
      mfaRequired: true,
    })
    const cookies = setCookies(reset)
    expect(cookies.has("naba_session")).toBe(false)
    // The mailbox alone changes nothing: same password, sessions intact.
    expect(auth.passwordUpdates.some((u) => u.email === email)).toBe(false)
    expect(auth.users.get(email)!.password).toBe(PASSWORD)
    expect((await sessionOf(earlier)).session).not.toBeNull()
    const [ticketRow] = await admin<{ completion: Record<string, unknown> }[]>`
      select completion from mfa_pending_login
      where auth_subject = ${auth.users.get(email)!.id}
    `
    // Held encrypted, never in the clear.
    expect(JSON.stringify(ticketRow.completion)).not.toContain(NEW_PASSWORD)
    expect(ticketRow.completion.newPasswordCiphertext).toEqual(
      expect.any(String)
    )

    const verify = await post(
      "/api/auth/mfa/verify",
      { code: STUB_TOTP_CODE },
      cookies.get("naba_mfa_ticket")
    )
    expect(verify.status).toBe(200)
    // Set with the aal2 token (the stub refuses aal1 for an enrolled user).
    expect(auth.users.get(email)!.password).toBe(NEW_PASSWORD)
    const fresh = setCookies(verify).get("naba_session")!
    const row = await sessionRow(fresh)
    expect(row).toMatchObject({ aal: "aal2", authMethod: "password_reset" })
    // Now the earlier session ends, and the reset is audited.
    expect((await sessionOf(earlier)).session).toBeNull()
    const userId = (await sessionOf(fresh)).session!.userId
    const [audit] = await admin<{ count: number }[]>`
      select count(*)::int as count from audit_log
      where actor_user_id = ${userId} and action = 'user.password_reset'
    `
    expect(audit.count).toBe(1)
  })

  it("leaves the password and sessions alone when a reset's code never comes", async () => {
    const { email } = newUser({ enrolled: true })
    const earlier = await signInWithCode(email)
    await post("/api/auth/password/reset/request", { email })
    const reset = await post("/api/auth/password/reset/complete", {
      tokenHash: auth.recoveryToken(email),
      password: "Attacker horse!44",
    })
    expect(await reset.json()).toMatchObject({ mfaRequired: true })
    const wrong = await post(
      "/api/auth/mfa/verify",
      { code: "000000" },
      setCookies(reset).get("naba_mfa_ticket")
    )
    expect(wrong.status).toBe(400)
    expect(auth.users.get(email)!.password).toBe(PASSWORD)
    expect((await sessionOf(earlier)).session).not.toBeNull()
  })

  it("fails closed when the provider does not raise the token to aal2, keeping the ticket", async () => {
    const { email } = newUser({ enrolled: true })
    const ticket = setCookies(await login(email)).get("naba_mfa_ticket")!
    auth.options.verifyAal = "aal1"
    try {
      const unconfirmed = await post(
        "/api/auth/mfa/verify",
        { code: STUB_TOTP_CODE },
        ticket
      )
      expect(unconfirmed.status).toBe(503)
      expect(await unconfirmed.json()).toMatchObject({
        error: "mfa_assurance_unconfirmed",
      })
      expect(setCookies(unconfirmed).has("naba_session")).toBe(false)
      const [user] = await admin`select id from app_user where email = ${email}`
      expect(user).toBeUndefined()
    } finally {
      auth.options.verifyAal = "aal2"
    }
    // Not consumed: the same ticket completes once the provider says aal2.
    const verify = await post(
      "/api/auth/mfa/verify",
      { code: STUB_TOTP_CODE },
      ticket
    )
    expect(verify.status).toBe(200)
  })

  it("mints exactly one session when one ticket is verified twice at once", async () => {
    const { email } = newUser({ enrolled: true })
    const ticket = setCookies(await login(email)).get("naba_mfa_ticket")!
    const responses = await Promise.all([
      post("/api/auth/mfa/verify", { code: STUB_TOTP_CODE }, ticket),
      post("/api/auth/mfa/verify", { code: STUB_TOTP_CODE }, ticket),
    ])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 401])
    const [count] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from app_session s join app_user u on u.id = s.user_id
      where u.email = ${email}
    `
    expect(count.count).toBe(1)
  })

  it("ends another person's session in this browser when a ticket is issued", async () => {
    const other = newUser()
    const otherCookie = setCookies(await login(other.email)).get(
      "naba_session"
    )!
    expect((await sessionOf(otherCookie)).session).not.toBeNull()
    const { email } = newUser({ enrolled: true })
    const first = await post(
      "/api/auth/password/login",
      { email, password: PASSWORD },
      otherCookie
    )
    expect(await first.json()).toMatchObject({ mfaRequired: true })
    const cleared = first.headers
      .getSetCookie()
      .find((header) => header.startsWith("naba_session="))
    expect(cleared).toMatch(/^naba_session=;/)
    expect((await sessionOf(otherCookie)).session).toBeNull()
    // So the code screen renders instead of redirecting into that session
    // (even for a browser that still sends the old cookie).
    const page = await fetch(`${server.baseUrl}/sign-in/verify`, {
      headers: { cookie: otherCookie },
      redirect: "manual",
    })
    expect(page.status).toBe(200)
  })

  it("does not tell registration that an enrolled account exists", async () => {
    const { email } = newUser({ enrolled: true })
    const registered = await post("/api/auth/password/register", {
      email,
      password: PASSWORD,
      displayName: "Someone",
    })
    expect(registered.status).toBe(202)
    expect(await registered.json()).toEqual({
      authenticated: false,
      confirmationRequired: true,
    })
    expect(setCookies(registered).has("naba_session")).toBe(false)
  })

  it("accepts an invitation only after the code", async () => {
    const owner = await steppedUpOwner()
    const { email } = newUser({ enrolled: true })
    const invited = await post(
      "/api/invitations",
      { email, role: "member", canPublish: false },
      owner.cookie
    )
    expect(invited.status).toBe(201)
    const { inviteUrl } = (await invited.json()) as { inviteUrl: string }
    const inviteToken = new URL(inviteUrl).pathname.split("/").at(-1)

    const first = await login(email, { inviteToken })
    expect(await first.json()).toMatchObject({ mfaRequired: true })
    const [pending] = await admin<{ acceptedAt: Date | null }[]>`
      select accepted_at as "acceptedAt" from invitation
      where organisation_id = ${owner.organisationId} and email = ${email}
    `
    expect(pending.acceptedAt).toBeNull()

    const verify = await post(
      "/api/auth/mfa/verify",
      { code: STUB_TOTP_CODE },
      setCookies(first).get("naba_mfa_ticket")
    )
    expect(verify.status).toBe(200)
    const session = await sessionOf(setCookies(verify).get("naba_session")!)
    expect(session.session?.organisationId).toBe(owner.organisationId)
    const [accepted] = await admin<{ acceptedAt: Date | null }[]>`
      select accepted_at as "acceptedAt" from invitation
      where organisation_id = ${owner.organisationId} and email = ${email}
    `
    expect(accepted.acceptedAt).toBeInstanceOf(Date)
  })

  it("routes an enrolled person's emailed link to the code screen", async () => {
    const email = `mfa-${randomUUID()}@nabapresence.test`
    emails.push(email)
    const registered = await post("/api/auth/password/register", {
      email,
      password: PASSWORD,
      displayName: "Link person",
    })
    expect(registered.status).toBe(202)
    auth.addFactor(email)
    const confirm = await openConfirmationLink(
      `${server.baseUrl}/auth/confirm?token_hash=${auth.confirmationToken(email)}&type=email`
    )
    expect(confirm.status).toBe(303)
    expect(new URL(confirm.headers.get("location")!).pathname).toBe(
      "/sign-in/verify"
    )
    const cookies = setCookies(confirm)
    expect(cookies.has("naba_session")).toBe(false)
    expect(cookies.has("naba_mfa_ticket")).toBe(true)
  })

  it("shows the code screen for an invitation link opened in a signed-in browser, then accepts it", async () => {
    const owner = await steppedUpOwner()
    const other = newUser()
    const otherCookie = setCookies(await login(other.email)).get(
      "naba_session"
    )!
    expect((await sessionOf(otherCookie)).session).not.toBeNull()

    const email = `mfa-${randomUUID()}@nabapresence.test`
    emails.push(email)
    const invited = await post(
      "/api/invitations",
      { email, role: "member", canPublish: false },
      owner.cookie
    )
    expect(invited.status).toBe(201)
    const { inviteUrl } = (await invited.json()) as { inviteUrl: string }
    const inviteToken = new URL(inviteUrl).pathname.split("/").at(-1)!
    const registered = await post("/api/auth/password/register", {
      email,
      password: PASSWORD,
      displayName: "Invited person",
    })
    expect(registered.status).toBe(202)
    auth.addFactor(email)

    const confirm = await openConfirmationLink(
      `${server.baseUrl}/auth/confirm?token_hash=${auth.confirmationToken(email)}&type=email&inviteToken=${encodeURIComponent(inviteToken)}`,
      { cookie: otherCookie }
    )
    expect(confirm.status).toBe(303)
    expect(new URL(confirm.headers.get("location")!).pathname).toBe(
      "/sign-in/verify"
    )
    const cleared = confirm.headers
      .getSetCookie()
      .find((header) => header.startsWith("naba_session="))
    expect(cleared).toMatch(/^naba_session=;/)
    expect((await sessionOf(otherCookie)).session).toBeNull()
    const ticket = setCookies(confirm).get("naba_mfa_ticket")
    expect(ticket).toBeDefined()

    // The code screen renders even for a browser still sending the old
    // cookie, instead of redirecting into the other person's inbox.
    const page = await fetch(`${server.baseUrl}/sign-in/verify`, {
      headers: { cookie: otherCookie },
      redirect: "manual",
    })
    expect(page.status).toBe(200)

    const [pending] = await admin<{ acceptedAt: Date | null }[]>`
      select accepted_at as "acceptedAt" from invitation
      where organisation_id = ${owner.organisationId} and email = ${email}
    `
    expect(pending.acceptedAt).toBeNull()
    const verify = await post(
      "/api/auth/mfa/verify",
      { code: STUB_TOTP_CODE },
      ticket
    )
    expect(verify.status).toBe(200)
    const session = await sessionOf(setCookies(verify).get("naba_session")!)
    expect(session.session?.organisationId).toBe(owner.organisationId)
    const [accepted] = await admin<{ acceptedAt: Date | null }[]>`
      select accepted_at as "acceptedAt" from invitation
      where organisation_id = ${owner.organisationId} and email = ${email}
    `
    expect(accepted.acceptedAt).toBeInstanceOf(Date)
  })

  it("carries assurance across a workspace switch and ends sessions on a security_version bump", async () => {
    const { email } = newUser({ enrolled: true })
    const cookie = await signInWithCode(email)
    const current = await sessionOf(cookie)
    const userId = current.session!.userId
    const other = randomUUID()
    organisations.push(other)
    await admin`
      insert into organisation (id, slug, name, workspace_mode)
      values (${other}, ${`mfa-${other.slice(0, 12)}`}, 'Second', 'business')
    `
    await admin`
      insert into member (organisation_id, user_id, role, can_publish)
      values (${other}, ${userId}, 'admin', true)
    `
    const before = await sessionRow(cookie)
    const switched = await post(
      "/api/session/switch",
      { organisationId: other },
      cookie
    )
    expect(switched.status).toBe(200)
    const switchedCookie = setCookies(switched).get("naba_session")!
    const after = await sessionRow(switchedCookie)
    expect(after).toMatchObject({
      aal: "aal2",
      mfaFactorId: before.mfaFactorId,
      authMethod: "password",
    })
    expect(after.mfaVerifiedAt).toEqual(before.mfaVerifiedAt)
    expect(after.mfaProofExpiresAt).toEqual(before.mfaProofExpiresAt)

    await admin`
      update app_user set security_version = security_version + 1
      where id = ${userId}
    `
    expect((await sessionOf(switchedCookie)).session).toBeNull()
    const [left] = await admin<{ count: number }[]>`
      select count(*)::int as count from app_session
      where user_id = ${userId} and organisation_id = ${other}
    `
    expect(left.count).toBe(0)
    // A fresh sign-in records the new version and works.
    const fresh = await signInWithCode(email)
    expect((await sessionRow(fresh)).securityVersion).toBe(2)
    expect((await sessionOf(fresh)).session).not.toBeNull()
  })

  it("enrolls a first factor and a backup, raising the session to aal2", async () => {
    const { email } = newUser()
    const cookie = setCookies(await login(email)).get("naba_session")!
    expect((await sessionRow(cookie)).aal).toBe("aal1")

    const wrongPassword = await post(
      "/api/auth/mfa/enroll",
      { password: "Wrong horse!42" },
      cookie
    )
    expect(wrongPassword.status).toBe(401)

    const enroll = await post(
      "/api/auth/mfa/enroll",
      { password: PASSWORD },
      cookie
    )
    expect(enroll.status).toBe(200)
    const enrollment = (await enroll.json()) as {
      factorId: string
      qrCode: string
      factorNumber: number
    }
    expect(enrollment.factorNumber).toBe(1)
    expect(enrollment.qrCode).toMatch(/^data:image\/svg\+xml/)
    const ticket = setCookies(enroll).get("naba_mfa_ticket")!

    // An enroll ticket works only for the session that opened it.
    const stranger = await createTestTenant(admin)
    organisations.push(stranger.organisationId)
    const hijack = await post(
      "/api/auth/mfa/verify",
      { code: STUB_TOTP_CODE },
      `${ticket}; ${stranger.cookie}`
    )
    expect(hijack.status).toBe(401)
    // Nor for another session of the same person.
    const sameUserOtherSession = setCookies(await login(email)).get(
      "naba_session"
    )!
    const sideways = await post(
      "/api/auth/mfa/verify",
      { code: STUB_TOTP_CODE },
      `${ticket}; ${sameUserOtherSession}`
    )
    expect(sideways.status).toBe(401)
    expect(await sideways.json()).toMatchObject({ error: "mfa_ticket_invalid" })

    const freshTicket = setCookies(
      await post("/api/auth/mfa/enroll", { password: PASSWORD }, cookie)
    ).get("naba_mfa_ticket")!
    const verify = await post(
      "/api/auth/mfa/verify",
      { code: STUB_TOTP_CODE },
      `${freshTicket}; ${cookie}`
    )
    expect(verify.status).toBe(200)
    expect(await verify.json()).toEqual({ verified: true, purpose: "enroll" })
    const raised = setCookies(verify).get("naba_session")!
    expect(raised).not.toBe(cookie)
    expect((await sessionOf(cookie)).session).toBeNull()
    expect((await sessionRow(raised)).aal).toBe("aal2")

    // The backup needs a code from the first factor.
    const noCode = await post(
      "/api/auth/mfa/enroll",
      { password: PASSWORD },
      raised
    )
    expect(noCode.status).toBe(400)
    expect(await noCode.json()).toMatchObject({ error: "mfa_code_required" })
    const backup = await post(
      "/api/auth/mfa/enroll",
      { password: PASSWORD, code: STUB_TOTP_CODE },
      raised
    )
    expect(backup.status).toBe(200)
    expect(await backup.json()).toMatchObject({ factorNumber: 2 })
    const backupVerify = await post(
      "/api/auth/mfa/verify",
      { code: STUB_TOTP_CODE },
      `${setCookies(backup).get("naba_mfa_ticket")}; ${raised}`
    )
    expect(backupVerify.status).toBe(200)
    const [count] = await admin<{ mfaFactorCount: number }[]>`
      select mfa_factor_count as "mfaFactorCount"
      from app_user where email = ${email}
    `
    expect(count.mfaFactorCount).toBe(2)

    // A third is refused; the next sign-in needs a code from either.
    const third = await post(
      "/api/auth/mfa/enroll",
      { password: PASSWORD, code: STUB_TOTP_CODE },
      setCookies(backupVerify).get("naba_session")!
    )
    expect(third.status).toBe(409)
    expect(await third.json()).toMatchObject({ error: "mfa_factor_limit" })
    const next = await login(email)
    expect(await next.json()).toMatchObject({ mfaRequired: true })
  })
})

describeDatabase("two-step verification per-account guessing limit", () => {
  let admin: ReturnType<typeof postgres>
  let auth: Awaited<ReturnType<typeof startAuthProviderStub>>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const email = `mfa-limit-${randomUUID()}@nabapresence.test`

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    auth = await startAuthProviderStub()
    server = await startAppServer({
      PASSWORD_AUTH_ENABLED: "true",
      MFA_ENABLED: "true",
      ABUSE_LIMITS_ENABLED: "true",
      SUPABASE_URL: auth.baseUrl,
      SUPABASE_PUBLISHABLE_KEY: "stub-publishable-key",
    })
  })

  afterAll(async () => {
    await server.stop()
    await auth.stop()
    const owned = await admin<{ id: string }[]>`
      select m.organisation_id::text as id
      from member m join app_user u on u.id = m.user_id
      where u.email = ${email}
    `
    await destroyTenants(
      admin,
      owned.map((row) => row.id)
    )
    await admin`delete from app_user where email = ${email}`
    await admin.end()
  })

  async function post(path: string, body: unknown, cookie?: string) {
    return fetch(`${server.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    })
  }

  it("caps code attempts per account across fresh tickets", async () => {
    auth.addUser({ id: randomUUID(), email, password: PASSWORD })
    auth.addFactor(email)
    // ABUSE_POLICIES.mfa_verify_account: 15 attempts per 15 minutes. Each
    // ticket allows five, so the fourth ticket's first attempt is refused.
    const statuses: number[] = []
    for (let ticketIndex = 0; ticketIndex < 4; ticketIndex += 1) {
      const login = await post("/api/auth/password/login", {
        email,
        password: PASSWORD,
      })
      expect(login.status).toBe(200)
      const ticket = setCookies(login).get("naba_mfa_ticket")!
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await post(
          "/api/auth/mfa/verify",
          { code: "000000" },
          ticket
        )
        statuses.push(response.status)
        if (response.status === 429) break
      }
      if (statuses.at(-1) === 429) break
    }
    expect(statuses.filter((status) => status !== 429)).toHaveLength(15)
    expect(statuses.at(-1)).toBe(429)

    // Even the right code on a brand-new ticket is refused for the window.
    const login = await post("/api/auth/password/login", {
      email,
      password: PASSWORD,
    })
    const right = await post(
      "/api/auth/mfa/verify",
      { code: STUB_TOTP_CODE },
      setCookies(login).get("naba_mfa_ticket")
    )
    expect(right.status).toBe(429)
    expect(await right.json()).toMatchObject({ error: "auth_rate_limited" })
  })
})

describeDatabase("two-step verification switched off", () => {
  let auth: Awaited<ReturnType<typeof startAuthProviderStub>>
  let server: Awaited<ReturnType<typeof startAppServer>>
  let admin: ReturnType<typeof postgres>
  const email = `mfa-off-${randomUUID()}@nabapresence.test`

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
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
    const owned = await admin<{ id: string }[]>`
      select m.organisation_id::text as id
      from member m join app_user u on u.id = m.user_id
      where u.email = ${email}
    `
    await destroyTenants(
      admin,
      owned.map((row) => row.id)
    )
    await admin`delete from app_user where email = ${email}`
    await admin.end()
  })

  it("signs an enrolled person in as before and hides the MFA routes", async () => {
    auth.addUser({ id: randomUUID(), email, password: PASSWORD })
    auth.addFactor(email)
    const response = await fetch(`${server.baseUrl}/api/auth/password/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ authenticated: true })
    const factors = await fetch(`${server.baseUrl}/api/auth/mfa/factors`)
    expect(factors.status).toBe(404)
  })
})
