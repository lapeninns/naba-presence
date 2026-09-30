import { createHmac, randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  notificationListResponseSchema,
  notificationPreferencesResponseSchema,
} from "@/lib/contracts/operational-notifications"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
  seedMemberUser,
} from "../helpers/tenant"

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
const CRON = { authorization: "Bearer route-harness-cron-secret" }
const SECRET_BYTES = Buffer.from("operational-notifications-webhook-secret")
const WEBHOOK_SECRET = `whsec_${SECRET_BYTES.toString("base64")}`

describeDatabase("WP8 operational notifications", { timeout: 45_000 }, () => {
  let admin: ReturnType<typeof postgres>
  let email: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  let emailStatus = 200
  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    email = await startGoogleStub()
    server = await startAppServer({
      EMAIL_PROVIDER: "resend",
      EMAIL_API_KEY: "test-email-key",
      EMAIL_FROM: "alerts@nabapresence.test",
      EMAIL_API_BASE_URL: email.baseUrl,
      EMAIL_WEBHOOK_SECRET: WEBHOOK_SECRET,
      LISTING_STALE_AFTER_HOURS: "6",
    })
  })
  afterAll(async () => {
    await server.stop()
    await email.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })
  let messageId = 0
  beforeEach(() => {
    emailStatus = 200
    email.reset()
    email.respond({ method: "POST", pathEndsWith: "/emails" }, () =>
      emailStatus === 200
        ? {
            status: 200,
            json: { id: `wp8-${(messageId += 1)}-${randomUUID()}` },
          }
        : { status: emailStatus, json: { message: "unavailable" } }
    )
  })
  const tick = async () => {
    const response = await fetch(`${server.baseUrl}/api/cron/health`, {
      method: "POST",
      headers: CRON,
    })
    expect(response.status, await response.clone().text()).toBe(200)
  }
  const emailsTo = (address: string) =>
    email.calls.filter(
      (call) =>
        call.path.endsWith("/emails") &&
        (call.body as { to: string[] }).to.includes(address)
    )
  const api = (cookie: string, path: string, init: RequestInit = {}) =>
    fetch(`${server.baseUrl}${path}`, {
      ...init,
      headers: {
        cookie,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    })

  async function tenant() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const first = await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      ...connection,
    })
    const second = await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      ...connection,
    })
    const [user] = await admin<
      { email: string }[]
    >`select email from app_user where id = ${owner.userId}`
    return { owner, ownerEmail: user.email, connection, first, second }
  }
  async function member(organisationId: string, locationId?: string) {
    const seeded = await seedMemberUser(admin, {
      organisationId,
      assignLocationId: locationId,
    })
    const [user] = await admin<
      { email: string }[]
    >`select email from app_user where id = ${seeded.userId}`
    return { ...seeded, email: user.email }
  }
  /** An event incident as a producer records it (recordOperationalEvent). */
  async function eventIncident(
    organisationId: string,
    kind: string,
    locationId: string | null,
    subject = randomUUID()
  ) {
    const [row] = await admin<{ id: string }[]>`
      insert into notification_incident (organisation_id, kind, subject_type, subject_id, summary, location_id, reason)
      values (${organisationId}, ${kind}, 'attempt', ${subject}, ${admin.json({ title: "Fixture listing" })}, ${locationId}, 'provider_rejected')
      returning id::text as id`
    return row.id
  }
  async function queueFor(
    organisationId: string,
    incidentId: string,
    userIds: string[]
  ) {
    for (const userId of userIds)
      await admin`insert into notification_delivery (organisation_id, incident_id, recipient_user_id) values (${organisationId}, ${incidentId}, ${userId})`
  }
  function sign(
    body: string,
    id = `msg_${randomUUID()}`,
    timestamp = Math.floor(Date.now() / 1000)
  ) {
    const signature = createHmac("sha256", SECRET_BYTES)
      .update(`${id}.${timestamp}.${body}`)
      .digest("base64")
    return {
      "svix-id": id,
      "svix-timestamp": String(timestamp),
      "svix-signature": `v1,${signature}`,
    }
  }
  const webhook = (body: string, headers: Record<string, string>) =>
    fetch(`${server.baseUrl}/api/webhooks/email`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    })

  it("keeps one open incident per subject, reads without resolving, and lets a manager resolve it", async () => {
    const t = await tenant()
    const attempt = randomUUID()
    const report = async (kind: string) => {
      const response = await fetch(`${server.baseUrl}/api/notifications`, {
        headers: { cookie: t.owner.cookie },
      })
      return notificationListResponseSchema
        .parse(await response.json())
        .items.filter((item) => item.kind === kind)
    }
    const subject = `${t.owner.organisationId}:location:${t.first.locationId}:attempt:links:${attempt}`
    for (let index = 0; index < 2; index += 1) {
      await admin`
        insert into notification_incident (organisation_id, kind, subject_type, subject_id, summary, location_id, reason)
        values (${t.owner.organisationId}, 'publication_failed', 'attempt', ${subject}, '{}'::jsonb, ${t.first.locationId}, 'provider_rejected')
        on conflict (organisation_id, kind, subject_id) where status = 'open' do update set last_seen_at = now()`
    }
    const [failed] = await report("publication_failed")
    expect(failed).toMatchObject({
      status: "open",
      readAt: null,
      canResolve: true,
    })
    const read = await api(t.owner.cookie, "/api/notifications/read", {
      method: "POST",
      body: JSON.stringify({ incidentIds: [failed.id] }),
    })
    expect(read.status).toBe(200)
    const [afterRead] = await report("publication_failed")
    expect(afterRead.status).toBe("open")
    expect(afterRead.readAt).not.toBeNull()
    const resolved = await api(
      t.owner.cookie,
      `/api/notifications/${failed.id}/resolve`,
      { method: "POST" }
    )
    expect(resolved.status).toBe(200)
    expect((await report("publication_failed"))[0].status).toBe("resolved")
  })

  it("scopes members to their locations and never shows them account incidents", async () => {
    const t = await tenant(),
      m = await member(t.owner.organisationId, t.first.locationId)
    const visible = await eventIncident(
      t.owner.organisationId,
      "publication_failed",
      t.first.locationId
    )
    const hidden = await eventIncident(
      t.owner.organisationId,
      "publication_failed",
      t.second.locationId
    )
    const account = await eventIncident(
      t.owner.organisationId,
      "connection_reconnect",
      null
    )
    const list = notificationListResponseSchema.parse(
      await (await api(m.cookie, "/api/notifications")).json()
    )
    expect(list.items.map((item) => item.id)).toEqual([visible])
    expect(list.items[0].canResolve).toBe(false)
    const outside = await api(m.cookie, "/api/notifications/read", {
      method: "POST",
      body: JSON.stringify({ incidentIds: [hidden, account] }),
    })
    expect(await outside.json()).toMatchObject({ updated: 0 })
    expect(
      (
        await api(m.cookie, `/api/notifications/${visible}/resolve`, {
          method: "POST",
        })
      ).status
    ).toBe(403)
    const condition = await admin<
      { id: string }[]
    >`select id::text as id from notification_incident where id = ${account}`
    expect(
      (
        await api(
          t.owner.cookie,
          `/api/notifications/${condition[0].id}/resolve`,
          { method: "POST" }
        )
      ).status
    ).toBe(409)
    const prefs = notificationPreferencesResponseSchema.parse(
      await (await api(m.cookie, "/api/notifications/preferences")).json()
    )
    expect(
      prefs.preferences.some(
        (preference) => preference.kind === "connection_reconnect"
      )
    ).toBe(false)
    expect(
      prefs.preferences.find(
        (preference) =>
          preference.kind === "publication_failed" &&
          preference.channel === "email"
      )
    ).toMatchObject({ mode: "off", explicit: false })
  })

  it("emails members only after opting in and suppresses a send after access is revoked", async () => {
    const t = await tenant(),
      m = await member(t.owner.organisationId, t.first.locationId)
    const optIn = await api(m.cookie, "/api/notifications/preferences", {
      method: "PUT",
      body: JSON.stringify({
        changes: [
          { kind: "publication_failed", channel: "email", mode: "immediate" },
        ],
      }),
    })
    expect(optIn.status, await optIn.clone().text()).toBe(200)
    const first = await eventIncident(
      t.owner.organisationId,
      "publication_failed",
      t.first.locationId
    )
    await queueFor(t.owner.organisationId, first, [m.userId, t.owner.userId])
    await tick()
    expect(emailsTo(m.email)).toHaveLength(1)
    expect(emailsTo(t.ownerEmail)).toHaveLength(1)
    await tick()
    expect(emailsTo(m.email)).toHaveLength(1)
    const second = await eventIncident(
      t.owner.organisationId,
      "publication_failed",
      t.first.locationId
    )
    await queueFor(t.owner.organisationId, second, [m.userId])
    await admin`delete from location_member where user_id = ${m.userId}`
    await admin`insert into location_member (organisation_id, location_id, user_id, can_publish) values (${t.owner.organisationId}, ${t.second.locationId}, ${m.userId}, false)`
    await tick()
    expect(emailsTo(m.email)).toHaveLength(1)
    const [suppressed] =
      await admin`select status, delivery_state, last_error_code from notification_delivery where incident_id = ${second} and recipient_user_id = ${m.userId}`
    expect(suppressed).toMatchObject({
      status: "suppressed",
      delivery_state: "suppressed",
      last_error_code: "recipient_access_revoked",
    })
    const third = await eventIncident(
      t.owner.organisationId,
      "publication_failed",
      t.second.locationId
    )
    await queueFor(t.owner.organisationId, third, [m.userId])
    await admin`delete from member where user_id = ${m.userId}`
    await tick()
    expect(emailsTo(m.email)).toHaveLength(1)
    const [removed] =
      await admin`select last_error_code from notification_delivery where incident_id = ${third}`
    expect(removed.last_error_code).toBe("recipient_not_member")
  })

  it("retries with the same idempotency key and records provider delivery evidence", async () => {
    const t = await tenant()
    const incident = await eventIncident(
      t.owner.organisationId,
      "publication_failed",
      t.first.locationId
    )
    await queueFor(t.owner.organisationId, incident, [t.owner.userId])
    emailStatus = 503
    await tick()
    const [pending] = await admin<
      { id: string; status: string; delivery_state: string }[]
    >`select id::text as id, status, delivery_state from notification_delivery where incident_id = ${incident}`
    expect(pending).toMatchObject({
      status: "pending",
      delivery_state: "queued",
    })
    await admin`update notification_delivery set next_attempt_at = now() where id = ${pending.id}`
    emailStatus = 200
    await tick()
    const keys = emailsTo(t.ownerEmail).map(
      (call) => call.headers?.["idempotency-key"]
    )
    expect(keys).toEqual([
      `notification-delivery/${pending.id}`,
      `notification-delivery/${pending.id}`,
    ])
    const [sent] = await admin<
      { provider_message_id: string; delivery_state: string }[]
    >`select provider_message_id, delivery_state from notification_delivery where id = ${pending.id}`
    expect(sent.delivery_state).toBe("accepted")

    const event = (type: string, createdAt: string) =>
      JSON.stringify({
        type,
        created_at: createdAt,
        data: { email_id: sent.provider_message_id },
      })
    const bad = await webhook(
      event("email.delivered", new Date().toISOString()),
      { ...sign("different body") }
    )
    expect(bad.status).toBe(400)
    const stale = event("email.delivered", new Date().toISOString())
    expect(
      (
        await webhook(
          stale,
          sign(stale, undefined, Math.floor(Date.now() / 1000) - 3_600)
        )
      ).status
    ).toBe(400)
    const delivered = event("email.delivered", new Date().toISOString()),
      deliveredHeaders = sign(delivered)
    const accepted = await webhook(delivered, deliveredHeaders)
    expect(accepted.status).toBe(202)
    expect(await accepted.json()).toMatchObject({ outcome: "applied" })
    expect(
      await (await webhook(delivered, deliveredHeaders)).json()
    ).toMatchObject({ outcome: "duplicate" })
    const late = event(
      "email.sent",
      new Date(Date.now() - 60_000).toISOString()
    )
    expect(await (await webhook(late, sign(late))).json()).toMatchObject({
      outcome: "superseded",
    })
    const opened = event("email.opened", new Date().toISOString())
    expect(await (await webhook(opened, sign(opened))).json()).toMatchObject({
      outcome: "ignored",
    })
    const bounced = event("email.bounced", new Date().toISOString())
    expect(await (await webhook(bounced, sign(bounced))).json()).toMatchObject({
      outcome: "applied",
    })
    const [final] =
      await admin`select delivery_state from notification_delivery where id = ${pending.id}`
    expect(final.delivery_state).toBe("bounced")
    const events =
      await admin`select event_type, applied from notification_delivery_event where delivery_id = ${pending.id} order by received_at`
    expect(events.map((row) => `${row.event_type}:${row.applied}`)).toEqual([
      "email.delivered:true",
      "email.sent:false",
      "email.opened:false",
      "email.bounced:true",
    ])
  })

  it("builds one digest per recipient per local day from opted-in unread incidents", async () => {
    const t = await tenant()
    const zone = [
      "Etc/GMT-14",
      "Etc/GMT-12",
      "Etc/GMT-10",
      "Etc/GMT-8",
      "Etc/GMT-6",
      "Etc/GMT-4",
      "Etc/GMT-2",
      "Etc/GMT",
      "Etc/GMT+2",
      "Etc/GMT+4",
      "Etc/GMT+6",
      "Etc/GMT+8",
      "Etc/GMT+10",
      "Etc/GMT+12",
    ].find((candidate) => {
      const hour = Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: candidate,
          hour: "2-digit",
          hourCycle: "h23",
        }).format(new Date())
      )
      return hour >= 9 && hour <= 22
    })!
    await admin`update organisation set default_timezone = ${zone} where id = ${t.owner.organisationId}`
    const choose = await api(t.owner.cookie, "/api/notifications/preferences", {
      method: "PUT",
      body: JSON.stringify({
        changes: [
          { kind: "suggestions_available", channel: "email", mode: "digest" },
        ],
      }),
    })
    expect(choose.status).toBe(200)
    const included = await eventIncident(
      t.owner.organisationId,
      "suggestions_available",
      t.first.locationId
    )
    const alreadyRead = await eventIncident(
      t.owner.organisationId,
      "suggestions_available",
      t.second.locationId
    )
    await eventIncident(
      t.owner.organisationId,
      "verification_changed",
      t.first.locationId
    )
    await api(t.owner.cookie, "/api/notifications/read", {
      method: "POST",
      body: JSON.stringify({ incidentIds: [alreadyRead] }),
    })
    await tick()
    await tick()
    const digests = await admin<
      { incident_ids: string[] }[]
    >`select incident_ids::text[] as incident_ids from notification_digest where organisation_id = ${t.owner.organisationId}`
    expect(digests).toEqual([{ incident_ids: [included] }])
    const digestEmails = emailsTo(t.ownerEmail).filter((call) =>
      (call.body as { subject: string }).subject.startsWith(
        "NabaPresence daily summary"
      )
    )
    expect(digestEmails).toHaveLength(1)
  })
})
