import { createHash, randomBytes, randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const CRON_BEARER = "Bearer route-harness-cron-secret"

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

/**
 * Platform sign-in and the Google grant are separate lifetimes. A session
 * slides forward while used (14 days idle), ends 90 days after sign-in
 * regardless, and can be ended everywhere at once -- and none of that ever
 * touches the organisation's Google connection or its background sync.
 */
describeDatabase("platform session lifetimes", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  let supportOffServer: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    stub.respond({ method: "GET", pathIncludes: "/reviews" }, () => ({
      status: 200,
      json: { reviews: [], totalReviewCount: 1 },
    }))
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      SESSION_IDLE_DAYS: "14",
      SESSION_ABSOLUTE_DAYS: "90",
      // On here so the support sign-out case below can resolve its session;
      // the default (off) has its own server in "support sessions off".
      SUPPORT_IMPERSONATION_ENABLED: "true",
    })
    supportOffServer = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
    })
  })

  afterAll(async () => {
    await server.stop()
    await supportOffServer.stop()
    await stub.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function tenant() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    return owner
  }

  async function addSession(
    userId: string,
    organisationId: string,
    lifetimes: { expires: string; absolute: string }
  ) {
    const token = randomBytes(32).toString("base64url")
    await admin`
      insert into app_session (token_hash, user_id, organisation_id, expires_at, absolute_expires_at)
      values (
        ${sha256(token)}, ${userId}, ${organisationId},
        now() + ${lifetimes.expires}::interval,
        now() + ${lifetimes.absolute}::interval
      )
    `
    return { token, cookie: `naba_session=${token}` }
  }

  function sessionRow(token: string) {
    return admin<{ idleDays: number; absoluteDays: number }[]>`
      select
        (extract(epoch from (expires_at - now())) / 86400)::float as "idleDays",
        (extract(epoch from (absolute_expires_at - now())) / 86400)::float as "absoluteDays"
      from app_session where token_hash = ${sha256(token)}
    `
  }

  function authed(cookie: string) {
    return fetch(`${server.baseUrl}/api/google/connections`, {
      headers: { cookie },
    })
  }

  it("slides the idle window forward while the session is used", async () => {
    const owner = await tenant()
    const session = await addSession(owner.userId, owner.organisationId, {
      expires: "1 hour",
      absolute: "90 days",
    })
    expect((await authed(session.cookie)).status).toBe(200)
    const [row] = await sessionRow(session.token)
    expect(row.idleDays).toBeGreaterThan(13.9)
    expect(row.idleDays).toBeLessThanOrEqual(14)
  })

  it("never slides past the absolute limit", async () => {
    const owner = await tenant()
    const session = await addSession(owner.userId, owner.organisationId, {
      expires: "1 hour",
      absolute: "2 days",
    })
    expect((await authed(session.cookie)).status).toBe(200)
    const [row] = await sessionRow(session.token)
    expect(row.idleDays).toBeLessThanOrEqual(row.absoluteDays + 0.0001)
    expect(row.idleDays).toBeLessThan(2.01)
  })

  it("ends a session that sat idle, and one past its absolute limit", async () => {
    const owner = await tenant()
    const idle = await addSession(owner.userId, owner.organisationId, {
      expires: "-1 minute",
      absolute: "80 days",
    })
    const old = await addSession(owner.userId, owner.organisationId, {
      expires: "10 days",
      absolute: "-1 minute",
    })
    expect((await authed(idle.cookie)).status).toBe(401)
    expect((await authed(old.cookie)).status).toBe(401)
  })

  it("ends only the support session when support signs out everywhere", async () => {
    const owner = await tenant()
    const customer = await addSession(owner.userId, owner.organisationId, {
      expires: "10 days",
      absolute: "80 days",
    })
    const token = randomBytes(32).toString("base64url")
    await admin`
      insert into app_session (token_hash, user_id, organisation_id, expires_at, absolute_expires_at, support_actor)
      values (${sha256(token)}, ${owner.userId}, ${owner.organisationId},
        now() + interval '1 hour', now() + interval '1 hour', 'support@naba.example')
    `
    const response = await fetch(`${server.baseUrl}/api/session?scope=all`, {
      method: "DELETE",
      headers: { cookie: `naba_session=${token}` },
    })
    expect(response.status).toBe(204)
    expect((await authed(`naba_session=${token}`)).status).toBe(401)
    // The customer's own devices stay signed in.
    expect((await authed(customer.cookie)).status).toBe(200)
    expect((await authed(owner.cookie)).status).toBe(200)
  })

  async function addSupportSession(userId: string, organisationId: string) {
    const token = randomBytes(32).toString("base64url")
    await admin`
      insert into app_session (token_hash, user_id, organisation_id, expires_at, absolute_expires_at, support_actor, impersonation_reason)
      values (${sha256(token)}, ${userId}, ${organisationId},
        now() + interval '1 hour', now() + interval '1 hour',
        'support@naba.example', 'Ticket 42: integration')
    `
    return { token, cookie: `naba_session=${token}` }
  }

  function sessionExists(token: string) {
    return admin<{ count: number }[]>`
      select count(*)::integer as count from app_session
      where token_hash = ${sha256(token)}
    `.then(([row]) => row.count === 1)
  }

  it("refuses a support session and deletes its row while support impersonation is off", async () => {
    const owner = await tenant()
    const support = await addSupportSession(owner.userId, owner.organisationId)
    const customer = await addSession(owner.userId, owner.organisationId, {
      expires: "10 days",
      absolute: "80 days",
    })
    const response = await fetch(
      `${supportOffServer.baseUrl}/api/google/connections`,
      { headers: { cookie: support.cookie } }
    )
    expect(response.status).toBe(401)
    expect(await sessionExists(support.token)).toBe(false)
    // The customer's own session is untouched and still resolves.
    const own = await fetch(
      `${supportOffServer.baseUrl}/api/google/connections`,
      { headers: { cookie: customer.cookie } }
    )
    expect(own.status).toBe(200)
  })

  it("will not issue a support session while support impersonation is off", async () => {
    const response = await fetch(
      `${supportOffServer.baseUrl}/api/support/impersonation`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${"s".repeat(32)}`,
        },
        body: "{}",
      }
    )
    expect(response.status).toBe(404)
  })

  it("revokes every support session with one audit row per organisation", async () => {
    const first = await tenant()
    const second = await tenant()
    const firstSupport = [
      await addSupportSession(first.userId, first.organisationId),
      await addSupportSession(first.userId, first.organisationId),
    ]
    const secondSupport = await addSupportSession(
      second.userId,
      second.organisationId
    )
    const customer = await addSession(first.userId, first.organisationId, {
      expires: "10 days",
      absolute: "80 days",
    })

    // The application role cannot run it: it is an operator operation.
    const runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, {
      max: 1,
    })
    try {
      await expect(
        runtime`select revoke_support_sessions('ops@naba.example', 'Not the app to decide')`
      ).rejects.toMatchObject({ code: "42501" })
    } finally {
      await runtime.end()
    }
    await expect(
      admin`select revoke_support_sessions('ops@naba.example', '  ')`
    ).rejects.toMatchObject({ code: "22023" })

    const [{ revoked }] = await admin<{ revoked: number }[]>`
      select revoke_support_sessions(
        'ops@naba.example', 'Pilot launch: impersonation disabled'
      ) as revoked
    `
    expect(revoked).toBeGreaterThanOrEqual(3)
    for (const support of [...firstSupport, secondSupport]) {
      expect(await sessionExists(support.token)).toBe(false)
    }
    // Ordinary sessions are not support sessions.
    expect(await sessionExists(customer.token)).toBe(true)
    expect(await sessionExists(first.cookie.replace("naba_session=", ""))).toBe(
      true
    )

    const audits = await admin<
      { organisationId: string; actorUserId: string | null; metadata: Record<string, unknown> }[]
    >`
      select organisation_id::text as "organisationId",
        actor_user_id::text as "actorUserId", metadata
      from audit_log
      where action = 'support.sessions_revoked'
        and organisation_id in (${first.organisationId}, ${second.organisationId})
      order by organisation_id
    `
    expect(audits).toHaveLength(2)
    const byOrganisation = new Map(
      audits.map((row) => [row.organisationId, row])
    )
    expect(byOrganisation.get(first.organisationId)).toMatchObject({
      actorUserId: null,
      metadata: {
        operator: "ops@naba.example",
        reason: "Pilot launch: impersonation disabled",
        revokedSessions: 2,
        supportActors: ["support@naba.example"],
      },
    })
    expect(
      byOrganisation.get(second.organisationId)?.metadata.revokedSessions
    ).toBe(1)

    // Nothing left to revoke: no rows, no audit.
    const [{ again }] = await admin<{ again: number }[]>`
      select revoke_support_sessions(
        'ops@naba.example', 'Pilot launch: second run'
      ) as again
    `
    expect(again).toBe(0)
    const [{ count }] = await admin<{ count: number }[]>`
      select count(*)::integer as count from audit_log
      where action = 'support.sessions_revoked'
        and organisation_id in (${first.organisationId}, ${second.organisationId})
    `
    expect(count).toBe(2)
  })

  it("signs a person out everywhere without touching Google or background sync", async () => {
    const owner = await tenant()
    const other = await tenant()
    const { connectionId, googleAccountName } = await seedGoogleConnection(
      admin,
      {
        organisationId: owner.organisationId,
      }
    )
    const linked = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId,
      googleAccountName,
    })
    // A second organisation this person belongs to, with its own session.
    const secondOrganisation = randomUUID()
    organisations.push(secondOrganisation)
    await admin`
      insert into organisation (id, name, slug)
      values (${secondOrganisation}, 'Second org', ${`second-${secondOrganisation.slice(0, 8)}`})
    `
    await admin`
      insert into member (organisation_id, user_id, role)
      values (${secondOrganisation}, ${owner.userId}, 'owner')
    `
    const laptop = await addSession(owner.userId, owner.organisationId, {
      expires: "10 days",
      absolute: "80 days",
    })
    const phone = await addSession(owner.userId, secondOrganisation, {
      expires: "10 days",
      absolute: "80 days",
    })

    const response = await fetch(`${server.baseUrl}/api/session?scope=all`, {
      method: "DELETE",
      headers: { cookie: owner.cookie },
    })
    expect(response.status).toBe(204)

    expect((await authed(owner.cookie)).status).toBe(401)
    expect((await authed(laptop.cookie)).status).toBe(401)
    expect((await authed(phone.cookie)).status).toBe(401)
    // Someone else's session is not theirs to end.
    expect((await authed(other.cookie)).status).toBe(200)

    // The organisation's Google connection is exactly as it was...
    const [connection] = await admin<{ status: string; hasToken: boolean }[]>`
      select status, refresh_token_ciphertext is not null or access_token_ciphertext is not null as "hasToken"
      from google_connection where id = ${connectionId}
    `
    expect(connection).toEqual({ status: "active", hasToken: true })

    // ...and background sync still reaches it with nobody signed in.
    const started = new Date()
    const enqueue = await fetch(`${server.baseUrl}/api/sync/reconcile`, {
      headers: { authorization: CRON_BEARER },
    })
    expect(enqueue.status).toBe(200)
    for (let tick = 0; tick < 5; tick += 1) {
      const [row] = await admin<{ at: Date | null }[]>`
        select last_succeeded_at as at from sync_checkpoint
        where external_location_id = ${linked.externalLocationId}
          and sync_type = 'reconcile'
      `
      if (row?.at && row.at >= started) break
      await fetch(`${server.baseUrl}/api/jobs/run`, {
        headers: { authorization: CRON_BEARER },
      })
    }
    const [reconciled] = await admin<{ at: Date | null }[]>`
      select last_succeeded_at as at from sync_checkpoint
      where external_location_id = ${linked.externalLocationId}
        and sync_type = 'reconcile'
    `
    expect(reconciled?.at?.getTime()).toBeGreaterThanOrEqual(started.getTime())
  }, 120_000)
})
