import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startAuthProviderStub } from "../helpers/auth-provider"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

function sessionCookie(response: Response) {
  const value = response.headers.get("set-cookie")?.split(";")[0]
  if (!value) throw new Error("Authentication response did not set a session")
  return value
}

describeDatabase("email and password authentication", () => {
  let admin: ReturnType<typeof postgres>
  let auth: Awaited<ReturnType<typeof startAuthProviderStub>>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  const emails: string[] = []

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
    await destroyTenants(admin, organisations)
    if (emails.length > 0) {
      await admin`delete from app_user where email in ${admin(emails)}`
    }
    await admin.end()
  })

  it("keeps the same organisation and Google connection across device logins", async () => {
    const email = `auth-route-${randomUUID()}@nabapresence.test`
    emails.push(email)
    auth.addUser({
      id: randomUUID(),
      email,
      password: "Correct horse!42",
      displayName: "Cross-device owner",
    })

    const firstLogin = await fetch(
      `${server.baseUrl}/api/auth/password/login`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "Correct horse!42" }),
      }
    )
    expect(firstLogin.status).toBe(200)
    const firstCookie = sessionCookie(firstLogin)
    const firstSessionResponse = await fetch(`${server.baseUrl}/api/session`, {
      headers: { cookie: firstCookie },
    })
    const firstSession = (await firstSessionResponse.json()) as {
      session: { organisationId: string; userId: string }
    }
    organisations.push(firstSession.session.organisationId)
    await seedGoogleConnection(admin, {
      organisationId: firstSession.session.organisationId,
    })

    const secondLogin = await fetch(
      `${server.baseUrl}/api/auth/password/login`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "Correct horse!42" }),
      }
    )
    expect(secondLogin.status).toBe(200)
    const secondCookie = sessionCookie(secondLogin)
    expect(secondCookie).not.toBe(firstCookie)
    const secondSessionResponse = await fetch(`${server.baseUrl}/api/session`, {
      headers: { cookie: secondCookie },
    })
    const secondSession = (await secondSessionResponse.json()) as {
      session: { organisationId: string; userId: string }
    }
    expect(secondSession.session.organisationId).toBe(
      firstSession.session.organisationId
    )
    expect(secondSession.session.userId).toBe(firstSession.session.userId)

    const [identity] = await admin<
      { userCount: number; connectionCount: number }[]
    >`
      select
        (
          select count(*)::int
          from app_user
          where email = ${email}
        ) as "userCount",
        (
          select count(*)::int
          from google_connection
          where organisation_id = ${firstSession.session.organisationId}
            and status = 'active'
        ) as "connectionCount"
    `
    expect(identity).toEqual({ userCount: 1, connectionCount: 1 })
  })

  it("returns the same generic invalid credentials for a wrong password and an unconfirmed account (D3)", async () => {
    const email = `auth-route-${randomUUID()}@nabapresence.test`
    emails.push(email)
    auth.addUser({
      id: randomUUID(),
      email,
      password: "Correct horse!42",
      confirmed: false,
    })

    const invalid = await fetch(`${server.baseUrl}/api/auth/password/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "Wrong password!42" }),
    })
    expect(invalid.status).toBe(401)
    expect(await invalid.json()).toMatchObject({
      error: "invalid_credentials",
    })

    // D3: an unconfirmed account with the *correct* password must be
    // indistinguishable from a wrong password - both are the generic
    // invalid_credentials, not a registration-confirming email_not_verified.
    const unconfirmed = await fetch(
      `${server.baseUrl}/api/auth/password/login`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "Correct horse!42" }),
      }
    )
    expect(unconfirmed.status).toBe(401)
    expect(await unconfirmed.json()).toMatchObject({
      error: "invalid_credentials",
    })
  })

  it("confirms registration through the server endpoint", async () => {
    const email = `auth-route-${randomUUID()}@nabapresence.test`
    emails.push(email)
    const registration = await fetch(
      `${server.baseUrl}/api/auth/password/register`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "Confirmed owner",
          email,
          password: "Correct horse!42",
        }),
      }
    )
    expect(registration.status).toBe(202)
    expect(await registration.json()).toMatchObject({
      authenticated: false,
      confirmationRequired: true,
    })

    const tokenHash = auth.confirmationToken(email)
    expect(tokenHash).toBeTruthy()
    const confirmation = await fetch(
      `${server.baseUrl}/auth/confirm?token_hash=${encodeURIComponent(tokenHash!)}&type=email`,
      { redirect: "manual" }
    )
    expect([303, 307]).toContain(confirmation.status)
    expect(confirmation.headers.get("location")).toBe(
      `${server.baseUrl}/home`
    )
    const cookie = sessionCookie(confirmation)
    const sessionResponse = await fetch(`${server.baseUrl}/api/session`, {
      headers: { cookie },
    })
    const session = (await sessionResponse.json()) as {
      session: { organisationId: string }
    }
    organisations.push(session.session.organisationId)
  })

  it("uses a uniform reset request and completes recovery", async () => {
    const email = `auth-route-${randomUUID()}@nabapresence.test`
    emails.push(email)
    auth.addUser({
      id: randomUUID(),
      email,
      password: "Old password!42",
    })

    const resetRequest = await fetch(
      `${server.baseUrl}/api/auth/password/reset/request`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      }
    )
    expect(resetRequest.status).toBe(202)
    expect(auth.resetRequests.at(-1)).toEqual({
      email,
      redirectTo: `${server.baseUrl}/auth/confirm?flow=recovery`,
    })

    const tokenHash = auth.recoveryToken(email)
    expect(tokenHash).toBeTruthy()
    const reset = await fetch(
      `${server.baseUrl}/api/auth/password/reset/complete`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tokenHash,
          password: "New password!84",
        }),
      }
    )
    expect(reset.status).toBe(200)
    expect(auth.passwordUpdates.at(-1)).toEqual({
      email,
      password: "New password!84",
    })
    const cookie = sessionCookie(reset)
    const sessionResponse = await fetch(`${server.baseUrl}/api/session`, {
      headers: { cookie },
    })
    const session = (await sessionResponse.json()) as {
      session: { organisationId: string }
    }
    organisations.push(session.session.organisationId)
  })

  it("accepts an invitation only for the verified invited email", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const email = `auth-route-${randomUUID()}@nabapresence.test`
    emails.push(email)
    auth.addUser({
      id: randomUUID(),
      email,
      password: "Invited member!42",
      displayName: "Invited member",
    })
    const invitationResponse = await fetch(
      `${server.baseUrl}/api/invitations`,
      {
        method: "POST",
        headers: {
          cookie: owner.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email,
          role: "member",
          canPublish: false,
        }),
      }
    )
    expect(invitationResponse.status).toBe(201)
    const invitation = (await invitationResponse.json()) as {
      inviteUrl: string
    }
    const inviteToken = new URL(invitation.inviteUrl).pathname
      .split("/")
      .at(-1)
    expect(inviteToken).toBeTruthy()

    const login = await fetch(`${server.baseUrl}/api/auth/password/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: "Invited member!42",
        inviteToken,
      }),
    })
    expect(login.status).toBe(200)
    const sessionResponse = await fetch(`${server.baseUrl}/api/session`, {
      headers: { cookie: sessionCookie(login) },
    })
    const session = (await sessionResponse.json()) as {
      session: {
        organisationId: string
        role: string
        canPublish: boolean
      }
    }
    expect(session.session).toMatchObject({
      organisationId: owner.organisationId,
      role: "member",
      canPublish: false,
    })

    const [accepted] = await admin<
      { acceptedAt: Date | null; memberCount: number }[]
    >`
      select
        i.accepted_at as "acceptedAt",
        (
          select count(*)::int
          from member m
          join app_user u on u.id = m.user_id
          where m.organisation_id = ${owner.organisationId}
            and u.email = ${email}
        ) as "memberCount"
      from invitation i
      where i.organisation_id = ${owner.organisationId}
        and i.email = ${email}
    `
    expect(accepted.acceptedAt).toBeInstanceOf(Date)
    expect(accepted.memberCount).toBe(1)
  })
})
