import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
  seedMemberUser,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const CRON_BEARER = "Bearer route-harness-cron-secret"
const OPS = "ops-alerts@nabapresence.test"

type SentEmail = { to: string[]; subject: string; text: string; from: string }

/**
 * The health tick end to end: incidents from real tenant state, deliveries
 * to owners and admins, deduplication across runs and retries, tenant
 * isolation, and operator alerts. Email goes to a local stub standing in for
 * the provider's HTTP API; nothing leaves the machine.
 */
describeDatabase("operational notifications", () => {
  let admin: ReturnType<typeof postgres>
  let email: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    email = await startGoogleStub()
    server = await startAppServer({
      EMAIL_PROVIDER: "resend",
      EMAIL_API_KEY: "test-email-key",
      EMAIL_FROM: "alerts@nabapresence.test",
      EMAIL_API_BASE_URL: email.baseUrl,
      OPS_ALERT_EMAILS: OPS,
      LISTING_STALE_AFTER_HOURS: "6",
    })
  })

  afterAll(async () => {
    await server.stop()
    await email.stop()
    await destroyTenants(admin, organisations)
    await admin`delete from platform_incident where subject = 'reconcile'`
    await admin.end()
  })

  let messageId = 0
  beforeEach(() => {
    email.reset()
    email.respond({ method: "POST", pathEndsWith: "/emails" }, () => ({
      status: 200,
      json: { id: `email-${(messageId += 1)}` },
    }))
  })

  function tick() {
    return fetch(`${server.baseUrl}/api/cron/health`, {
      method: "POST",
      headers: { authorization: CRON_BEARER },
    })
  }

  async function runTick() {
    const response = await tick()
    expect(response.status, await response.clone().text()).toBe(200)
    return response.json() as Promise<{ skipped: boolean }>
  }

  function sentTo(address: string): SentEmail[] {
    return email.calls
      .filter((call) => call.path.endsWith("/emails"))
      .map((call) => call.body as SentEmail)
      .filter((body) => body.to.includes(address))
  }

  async function tenantWithLogin() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    return { owner, ...connection }
  }

  async function breakLogin(organisationId: string, connectionId: string) {
    await admin`
      update google_connection
      set status = 'revoked', last_error_code = 'invalid_grant'
      where id = ${connectionId}
    `
    await admin`
      insert into connection_task (
        organisation_id, google_connection_id, task_type, status, reason_code
      )
      values (${organisationId}, ${connectionId}, 'reconnect', 'open', 'invalid_grant')
    `
  }

  function incidents(organisationId: string, kind?: string) {
    return admin<{ kind: string; status: string; subjectId: string }[]>`
      select kind, status, subject_id as "subjectId"
      from notification_incident
      where organisation_id = ${organisationId}
        ${kind ? admin`and kind = ${kind}` : admin``}
      order by opened_at
    `
  }

  it("emails the owners and admins of the affected tenant once, and only them", async () => {
    const broken = await tenantWithLogin()
    const healthy = await tenantWithLogin()
    const adminUser = await admin<{ id: string; email: string }[]>`
      insert into app_user (id, email, display_name, default_organisation_id)
      values (
        ${randomUUID()}, ${`harness-admin-${randomUUID().slice(0, 8)}@nabapresence.test`},
        'Harness admin', ${broken.owner.organisationId}
      )
      returning id::text as id, email
    `
    await admin`
      insert into member (organisation_id, user_id, role)
      values (${broken.owner.organisationId}, ${adminUser[0].id}, 'admin')
    `
    const member = await seedMemberUser(admin, {
      organisationId: broken.owner.organisationId,
    })
    const [memberUser] = await admin<{ email: string }[]>`
      select email from app_user where id = ${member.userId}
    `
    await breakLogin(broken.owner.organisationId, broken.connectionId)

    await runTick()
    await runTick()

    expect(
      await incidents(broken.owner.organisationId, "connection_reconnect")
    ).toEqual([
      expect.objectContaining({
        status: "open",
        subjectId: broken.connectionId,
      }),
    ])
    const toOwner = sentTo(broken.owner.email)
    expect(toOwner).toHaveLength(1)
    expect(toOwner[0].subject).toBe(
      "Action needed: reconnect stub@example.test"
    )
    expect(sentTo(adminUser[0].email)).toHaveLength(1)
    // A member cannot reconnect, so is not the one to email.
    expect(sentTo(memberUser.email)).toHaveLength(0)
    // The healthy tenant hears nothing.
    expect(await incidents(healthy.owner.organisationId)).toEqual([])
    expect(sentTo(healthy.owner.email)).toHaveLength(0)
    // Nothing secret in the message.
    expect(toOwner[0].text).not.toMatch(/token|ciphertext|invalid_grant/i)
  }, 120_000)

  it("resolves a fixed problem and treats its return as a new incident", async () => {
    const tenant = await tenantWithLogin()
    await breakLogin(tenant.owner.organisationId, tenant.connectionId)
    await runTick()
    expect(sentTo(tenant.owner.email)).toHaveLength(1)

    await admin`
      update connection_task set status = 'completed', resolved_at = now()
      where google_connection_id = ${tenant.connectionId}
    `
    await admin`update google_connection set status = 'active' where id = ${tenant.connectionId}`
    await runTick()
    expect(
      (
        await incidents(tenant.owner.organisationId, "connection_reconnect")
      ).map((row) => row.status)
    ).toEqual(["resolved"])

    await breakLogin(tenant.owner.organisationId, tenant.connectionId)
    await runTick()
    expect(
      (
        await incidents(tenant.owner.organisationId, "connection_reconnect")
      ).map((row) => row.status)
    ).toEqual(["resolved", "open"])
    expect(sentTo(tenant.owner.email)).toHaveLength(2)
  }, 120_000)

  it("retries a failed send without ever sending twice", async () => {
    const tenant = await tenantWithLogin()
    await breakLogin(tenant.owner.organisationId, tenant.connectionId)
    email.reset()
    email.respond({ method: "POST", pathEndsWith: "/emails" }, () => ({
      status: 503,
      json: { message: "provider down" },
    }))
    await runTick()
    const [pending] = await admin<{ status: string; attempts: number }[]>`
      select d.status, d.attempts
      from notification_delivery d
      join notification_incident i on i.id = d.incident_id
      where i.organisation_id = ${tenant.owner.organisationId}
    `
    expect(pending).toMatchObject({ status: "pending", attempts: 1 })

    email.reset()
    email.respond({ method: "POST", pathEndsWith: "/emails" }, () => ({
      status: 200,
      json: { id: "retried" },
    }))
    await admin`
      update notification_delivery set next_attempt_at = now()
      where organisation_id = ${tenant.owner.organisationId}
    `
    await runTick()
    await runTick()
    expect(sentTo(tenant.owner.email)).toHaveLength(1)
    const [sent] = await admin<{ status: string; providerMessageId: string }[]>`
      select status, provider_message_id as "providerMessageId"
      from notification_delivery
      where organisation_id = ${tenant.owner.organisationId}
    `
    expect(sent).toEqual({ status: "sent", providerMessageId: "retried" })
  }, 120_000)

  it("flags a listing with no successful check for six hours, not a fresh one", async () => {
    const tenant = await tenantWithLogin()
    const stale = await seedLinkedReview(admin, {
      organisationId: tenant.owner.organisationId,
      connectionId: tenant.connectionId,
      googleAccountName: tenant.googleAccountName,
    })
    const fresh = await seedLinkedReview(admin, {
      organisationId: tenant.owner.organisationId,
      connectionId: tenant.connectionId,
      googleAccountName: tenant.googleAccountName,
    })
    await admin`
      update location_link set created_at = now() - interval '2 days'
      where external_location_id in (${stale.externalLocationId}, ${fresh.externalLocationId})
    `
    // The stale one last SUCCEEDED seven hours ago and has failed since.
    await admin`
      insert into sync_checkpoint (
        organisation_id, external_location_id, sync_type, status,
        finished_at, last_succeeded_at
      )
      values
        (${tenant.owner.organisationId}, ${stale.externalLocationId}, 'reconcile',
         'failed', now(), now() - interval '7 hours'),
        (${tenant.owner.organisationId}, ${fresh.externalLocationId}, 'reconcile',
         'succeeded', now(), now() - interval '10 minutes')
    `
    await runTick()
    expect(
      await incidents(tenant.owner.organisationId, "listing_stale")
    ).toEqual([
      expect.objectContaining({
        subjectId: stale.externalLocationId,
        status: "open",
      }),
    ])
    expect(
      sentTo(tenant.owner.email).filter((mail) =>
        mail.subject.startsWith("Data delayed")
      )
    ).toHaveLength(1)
  }, 120_000)

  it("announces a new low-rated review once, and never an old or a good one", async () => {
    const tenant = await tenantWithLogin()
    const low = await seedLinkedReview(admin, {
      organisationId: tenant.owner.organisationId,
      connectionId: tenant.connectionId,
      googleAccountName: tenant.googleAccountName,
      rating: 2,
      text: "Private reviewer words that must not be emailed",
    })
    await seedLinkedReview(admin, {
      organisationId: tenant.owner.organisationId,
      connectionId: tenant.connectionId,
      googleAccountName: tenant.googleAccountName,
      rating: 5,
    })
    const old = await seedLinkedReview(admin, {
      organisationId: tenant.owner.organisationId,
      connectionId: tenant.connectionId,
      googleAccountName: tenant.googleAccountName,
      rating: 1,
    })
    await admin`
      update review set create_time = now() - interval '5 days'
      where id = ${old.reviewId}
    `
    await runTick()
    await runTick()
    expect(
      await incidents(tenant.owner.organisationId, "low_rating_review")
    ).toEqual([expect.objectContaining({ subjectId: low.reviewId })])
    const mails = sentTo(tenant.owner.email).filter((mail) =>
      mail.subject.startsWith("New 2-star review")
    )
    expect(mails).toHaveLength(1)
    expect(mails[0].text).not.toContain("Private reviewer words")
    expect(mails[0].text).not.toContain("Stub reviewer")
  }, 120_000)

  it("asks admins to take over a login whose connecting member left, without breaking it", async () => {
    const tenant = await tenantWithLogin()
    const leaver = await seedMemberUser(admin, {
      organisationId: tenant.owner.organisationId,
    })
    await admin`
      update google_connection set connected_by_user_id = ${leaver.userId}
      where id = ${tenant.connectionId}
    `
    await runTick()
    expect(
      await incidents(tenant.owner.organisationId, "connection_owner_left")
    ).toEqual([])

    await admin`
      delete from member
      where organisation_id = ${tenant.owner.organisationId}
        and user_id = ${leaver.userId}
    `
    await runTick()
    expect(
      await incidents(tenant.owner.organisationId, "connection_owner_left")
    ).toEqual([
      expect.objectContaining({
        subjectId: tenant.connectionId,
        status: "open",
      }),
    ])
    const [connection] = await admin<{ status: string }[]>`
      select status from google_connection where id = ${tenant.connectionId}
    `
    expect(connection.status).toBe("active")
    expect(
      sentTo(tenant.owner.email).filter((mail) =>
        mail.subject.startsWith("The person who connected")
      )
    ).toHaveLength(1)
  }, 120_000)

  it("shows each tenant only its own incidents, and only to owners and admins", async () => {
    const first = await tenantWithLogin()
    const second = await tenantWithLogin()
    await breakLogin(first.owner.organisationId, first.connectionId)
    await runTick()

    const own = await fetch(`${server.baseUrl}/api/notifications`, {
      headers: { cookie: first.owner.cookie },
    })
    expect(own.status).toBe(200)
    const ownBody = (await own.json()) as { incidents: { subjectId: string }[] }
    expect(ownBody.incidents.map((incident) => incident.subjectId)).toContain(
      first.connectionId
    )

    const other = await fetch(`${server.baseUrl}/api/notifications`, {
      headers: { cookie: second.owner.cookie },
    })
    const otherBody = (await other.json()) as {
      incidents: { subjectId: string }[]
    }
    expect(
      otherBody.incidents.map((incident) => incident.subjectId)
    ).not.toContain(first.connectionId)

    const member = await seedMemberUser(admin, {
      organisationId: first.owner.organisationId,
    })
    const forbidden = await fetch(`${server.baseUrl}/api/notifications`, {
      headers: { cookie: member.cookie },
    })
    expect(forbidden.status).toBe(403)
  }, 120_000)

  it("alerts operators when a tick that used to run stops", async () => {
    const [before] = await admin<{ beatAt: Date | null }[]>`
      select beat_at as "beatAt" from ops_heartbeat where name = 'reconcile'
    `
    await admin`
      insert into ops_heartbeat (name, beat_at)
      values ('reconcile', now() - interval '2 days')
      on conflict (name) do update set beat_at = excluded.beat_at
    `
    try {
      await runTick()
      await runTick()
      const [incident] = await admin<
        { status: string; notifyStatus: string }[]
      >`
        select status, notify_status as "notifyStatus"
        from platform_incident
        where kind = 'stale_heartbeat' and subject = 'reconcile' and status = 'open'
      `
      expect(incident).toEqual({ status: "open", notifyStatus: "sent" })
      expect(
        sentTo(OPS).filter((mail) =>
          mail.subject.includes("reconcile tick has stopped")
        )
      ).toHaveLength(1)
    } finally {
      await admin`
        update ops_heartbeat set beat_at = ${before?.beatAt ?? new Date()}
        where name = 'reconcile'
      `
    }
  }, 120_000)
})

describeDatabase("notifications without an email provider", () => {
  it("records incidents and suppresses email instead of claiming it was sent", async () => {
    const admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    const email = await startGoogleStub()
    const server = await startAppServer({
      EMAIL_PROVIDER: "none",
      EMAIL_API_BASE_URL: email.baseUrl,
    })
    const organisations: string[] = []
    try {
      const owner = await createTestTenant(admin)
      organisations.push(owner.organisationId)
      const { connectionId } = await seedGoogleConnection(admin, {
        organisationId: owner.organisationId,
      })
      await admin`update google_connection set status = 'revoked' where id = ${connectionId}`
      await admin`
        insert into connection_task (organisation_id, google_connection_id, task_type, status, reason_code)
        values (${owner.organisationId}, ${connectionId}, 'reconnect', 'open', 'invalid_grant')
      `
      const response = await fetch(`${server.baseUrl}/api/cron/health`, {
        method: "POST",
        headers: { authorization: CRON_BEARER },
      })
      expect(response.status).toBe(200)
      const [delivery] = await admin<{ status: string; code: string }[]>`
        select status, last_error_code as code
        from notification_delivery where organisation_id = ${owner.organisationId}
      `
      expect(delivery).toEqual({
        status: "suppressed",
        code: "provider_not_configured",
      })
      expect(email.calls).toHaveLength(0)
    } finally {
      await server.stop()
      await email.stop()
      await destroyTenants(admin, organisations)
      await admin.end()
    }
  }, 120_000)
})
