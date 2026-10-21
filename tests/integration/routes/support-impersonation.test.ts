import { createHash, randomBytes } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

/**
 * NP3-G04: support impersonation at the real boundary. The route is public,
 * authenticated by SUPPORT_IMPERSONATION_SECRET, and mints a session into a
 * customer tenant, so each guard is proven against the standalone build and
 * the database rather than module mocks (tests/server/support-session-routes
 * covers the switch and sign-out refusals with mocks).
 */

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const SECRET = "support-harness-secret-with-32-characters!"
const ACTOR = "support@nabapresence.test"
const REASON = "Ticket 42: customer cannot see their reviews"
// The policy in lib/server/abuse-limits.ts (support_impersonation).
const GUESSES_PER_HOUR = 10
const IP_HEADER = "x-vercel-forwarded-for"

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex")

/**
 * A client in its own /64 of the IPv6 documentation range: abuse budgets are
 * kept per /64 for an hour in the shared database, so every request that
 * should not share a budget gets a fresh one, across runs too.
 */
const freshIp = () =>
  `2001:db8:${randomBytes(6).toString("hex").match(/.{4}/g)!.join(":")}::1`

describeDatabase("support impersonation", () => {
  let admin: ReturnType<typeof postgres>
  let enabled: Awaited<ReturnType<typeof startAppServer>>
  let disabled: Awaited<ReturnType<typeof startAppServer>>
  let enabledWithoutSecret: Awaited<ReturnType<typeof startAppServer>>
  let tenantA: Awaited<ReturnType<typeof createTestTenant>>
  let tenantB: Awaited<ReturnType<typeof createTestTenant>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    tenantA = await createTestTenant(admin)
    tenantB = await createTestTenant(admin)
    organisations.push(tenantA.organisationId, tenantB.organisationId)
    const common = {
      ABUSE_LIMITS_ENABLED: "true",
      CLIENT_IP_HEADER: IP_HEADER,
    }
    ;[enabled, disabled, enabledWithoutSecret] = await Promise.all([
      startAppServer({
        ...common,
        SUPPORT_IMPERSONATION_ENABLED: "true",
        SUPPORT_IMPERSONATION_SECRET: SECRET,
        // Step-up is enforced only with two-step verification switched on.
        MFA_ENABLED: "true",
      }),
      // The production default: a secret on its own issues nothing.
      startAppServer({ ...common, SUPPORT_IMPERSONATION_SECRET: SECRET }),
      startAppServer({ ...common, SUPPORT_IMPERSONATION_ENABLED: "true" }),
    ])
  })

  afterAll(async () => {
    await Promise.all(
      [enabled, disabled, enabledWithoutSecret].map((server) => server?.stop())
    )
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  function impersonate(
    server: { baseUrl: string },
    {
      secret = SECRET,
      clientIp = freshIp(),
      target = {
        organisationId: tenantA.organisationId,
        userId: tenantA.userId,
      },
      headers = {},
    }: {
      secret?: string
      clientIp?: string
      target?: { organisationId: string; userId: string }
      headers?: Record<string, string>
    } = {}
  ) {
    return fetch(`${server.baseUrl}/api/support/impersonation`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "x-support-actor": ACTOR,
        "x-support-reason": REASON,
        "content-type": "application/json",
        [IP_HEADER]: clientIp,
        ...headers,
      },
      body: JSON.stringify(target),
    })
  }

  function sessionToken(response: Response) {
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("naba_session="))
    return cookie ? cookie.slice("naba_session=".length).split(";")[0] : null
  }

  async function currentSession(server: { baseUrl: string }, token: string) {
    const response = await fetch(`${server.baseUrl}/api/session`, {
      headers: { cookie: `naba_session=${token}` },
    })
    expect(response.status).toBe(200)
    return (await response.json()).session as null | {
      userId: string
      organisationId: string
      supportActor?: string | null
      impersonationReason?: string | null
    }
  }

  async function supportSessionsFor(userId: string) {
    return admin<{ tokenHash: string }[]>`
      select token_hash as "tokenHash" from app_session
      where user_id = ${userId} and support_actor is not null
    `
  }

  async function errorOf(response: Response) {
    return (await response.json()).error as string
  }

  it("is off by default: a configured secret alone issues nothing", async () => {
    const response = await impersonate(disabled)
    expect(response.status).toBe(404)
    expect(await errorOf(response)).toBe("support_impersonation_disabled")
    expect(sessionToken(response)).toBeNull()
  })

  it("enabled without a secret issues nothing, with the same answer", async () => {
    const response = await impersonate(enabledWithoutSecret)
    expect(response.status).toBe(404)
    expect(await errorOf(response)).toBe("support_impersonation_disabled")
    expect(sessionToken(response)).toBeNull()
  })

  it("refuses a wrong, missing or prefix secret", async () => {
    for (const headers of [
      { authorization: `Bearer ${SECRET.slice(0, -1)}x` },
      { authorization: `Bearer ${SECRET.slice(0, -1)}` },
      { authorization: `Bearer ${SECRET}extra` },
      { authorization: SECRET.replace(/./, "X") },
      { authorization: "" },
    ]) {
      const response = await impersonate(enabled, { headers })
      expect(response.status, headers.authorization).toBe(401)
      expect(await errorOf(response)).toBe("invalid_support_credential")
      expect(sessionToken(response)).toBeNull()
    }
    expect(await supportSessionsFor(tenantA.userId)).toEqual([])
  })

  it("throttles guesses per client IP, then refuses even the right secret", async () => {
    const clientIp = freshIp()
    for (let guess = 0; guess < GUESSES_PER_HOUR; guess += 1) {
      const response = await impersonate(enabled, {
        clientIp,
        secret: "w".repeat(SECRET.length),
      })
      expect(response.status).toBe(401)
    }
    const throttled = await impersonate(enabled, { clientIp })
    expect(throttled.status).toBe(429)
    expect(await errorOf(throttled)).toBe("auth_rate_limited")
    expect(sessionToken(throttled)).toBeNull()
    expect(await supportSessionsFor(tenantA.userId)).toEqual([])

    // The budget is per IP: another client is not locked out.
    const other = await impersonate(enabled)
    expect(other.status).toBe(200)
    const token = sessionToken(other)
    expect(token).not.toBeNull()
    await admin`delete from app_session where token_hash = ${sha256(token!)}`
  })

  it("refuses a target user who is not a member of the named organisation", async () => {
    const response = await impersonate(enabled, {
      target: {
        organisationId: tenantA.organisationId,
        userId: tenantB.userId,
      },
    })
    expect(response.status).toBe(404)
    expect(await errorOf(response)).toBe("support_target_not_found")
    expect(sessionToken(response)).toBeNull()
    expect(await supportSessionsFor(tenantB.userId)).toEqual([])
    const audits = await admin`
      select 1 from audit_log
      where organisation_id = ${tenantA.organisationId}
        and action = 'support.impersonation.started'
        and subject_id = ${tenantB.userId}
    `
    expect(audits).toHaveLength(0)
  })

  it("refuses an unattributed request even with the right secret", async () => {
    const unattributed: Record<string, string>[] = [
      { "x-support-actor": "not-an-email" },
      { "x-support-reason": "short" },
    ]
    for (const headers of unattributed) {
      const response = await impersonate(enabled, { headers })
      expect(response.status, JSON.stringify(headers)).toBe(400)
      expect(sessionToken(response)).toBeNull()
    }
    expect(await supportSessionsFor(tenantA.userId)).toEqual([])
  })

  it("issues a one-hour, attributed, audited session scoped to the target", async () => {
    const response = await impersonate(enabled)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      impersonating: true,
      expiresWithinMinutes: 60,
    })
    const token = sessionToken(response)!
    expect(token).toBeTruthy()

    const [row] = await admin<
      {
        userId: string
        organisationId: string
        supportActor: string
        reason: string
        aal: string
        expiresInSeconds: number
        fixedLength: boolean
      }[]
    >`
      select user_id::text as "userId", organisation_id::text as "organisationId",
        support_actor as "supportActor", impersonation_reason as reason, aal,
        extract(epoch from expires_at - now())::float8 as "expiresInSeconds",
        expires_at = absolute_expires_at as "fixedLength"
      from app_session where token_hash = ${sha256(token)}
    `
    expect(row).toMatchObject({
      userId: tenantA.userId,
      organisationId: tenantA.organisationId,
      supportActor: ACTOR,
      reason: REASON,
      // Never carries the customer's two-step proof.
      aal: "aal1",
      fixedLength: true,
    })
    expect(row.expiresInSeconds).toBeGreaterThan(55 * 60)
    expect(row.expiresInSeconds).toBeLessThanOrEqual(60 * 60)

    const [audit] = await admin<
      {
        actorUserId: string | null
        subjectType: string
        metadata: Record<string, unknown>
      }[]
    >`
      select actor_user_id::text as "actorUserId", subject_type as "subjectType", metadata
      from audit_log
      where organisation_id = ${tenantA.organisationId}
        and action = 'support.impersonation.started'
        and subject_id = ${tenantA.userId}
      order by created_at desc limit 1
    `
    expect(audit).toMatchObject({
      actorUserId: null,
      subjectType: "user",
      metadata: {
        supportActor: ACTOR,
        reason: REASON,
        expiresWithinMinutes: 60,
      },
    })

    const session = await currentSession(enabled, token)
    expect(session).toMatchObject({
      userId: tenantA.userId,
      organisationId: tenantA.organisationId,
      supportActor: ACTOR,
      impersonationReason: REASON,
    })

    // Using it does not slide it: the hour is fixed from issuance.
    const [after] = await admin<
      { fixedLength: boolean; expiresInSeconds: number }[]
    >`
      select expires_at = absolute_expires_at as "fixedLength",
        extract(epoch from expires_at - now())::float8 as "expiresInSeconds"
      from app_session where token_hash = ${sha256(token)}
    `
    expect(after.fixedLength).toBe(true)
    expect(after.expiresInSeconds).toBeLessThanOrEqual(row.expiresInSeconds)

    // A step-up-only action is refused: the session holds no MFA proof.
    const stepUp = await fetch(`${enabled.baseUrl}/api/settings`, {
      method: "PATCH",
      headers: {
        cookie: `naba_session=${token}`,
        "content-type": "application/json",
      },
      body: "{}",
    })
    expect(stepUp.status).toBe(403)
    expect(await errorOf(stepUp)).toMatch(/^mfa_(step_up|enrollment)_required$/)

    // Ending it is audited and the session stops resolving.
    const end = await fetch(`${enabled.baseUrl}/api/support/impersonation`, {
      method: "DELETE",
      headers: { cookie: `naba_session=${token}` },
    })
    expect(end.status).toBe(200)
    expect(await end.json()).toEqual({ impersonating: false })
    expect(await currentSession(enabled, token)).toBeNull()
    const ended = await admin`
      select 1 from audit_log
      where organisation_id = ${tenantA.organisationId}
        and action = 'support.impersonation.ended'
        and subject_id = ${tenantA.userId}
    `
    expect(ended).toHaveLength(1)
  })

  it("honours expiry", async () => {
    const response = await impersonate(enabled)
    expect(response.status).toBe(200)
    const token = sessionToken(response)!
    expect(await currentSession(enabled, token)).not.toBeNull()

    await admin`
      update app_session
      set expires_at = now() - interval '1 second',
        absolute_expires_at = now() - interval '1 second'
      where token_hash = ${sha256(token)}
    `
    expect(await currentSession(enabled, token)).toBeNull()
    const settings = await fetch(`${enabled.baseUrl}/api/settings`, {
      headers: { cookie: `naba_session=${token}` },
    })
    expect(settings.status).toBe(401)
  })

  it("switching the feature off ends an outstanding support session", async () => {
    const response = await impersonate(enabled)
    expect(response.status).toBe(200)
    const token = sessionToken(response)!

    // Same database, flag off: the session no longer resolves and its row
    // is deleted (lib/server/session.ts).
    expect(await currentSession(disabled, token)).toBeNull()
    const rows =
      await admin`select 1 from app_session where token_hash = ${sha256(token)}`
    expect(rows).toHaveLength(0)
  })
})
