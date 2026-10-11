import { randomUUID } from "node:crypto"

import postgres from "postgres"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedMemberUser,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const CRON = { authorization: "Bearer route-harness-cron-secret" }
// The app caches the pause table for 5s (lib/server/pause-controls.ts).
const PAUSE_PROPAGATION_MS = 5_300

type SentEmail = { to: string[]; subject: string; text: string }
type Delivery = {
  id: string
  kind: "initial" | "resend"
  status: string
  errorCode: string | null
  attempts: number
  sentAt: string | null
}

/**
 * App-sent invitations (plan P06-6, migration 0104) end to end: the
 * `invitation_email` feature gate, the inline send on create, retries on the
 * job tick, Resend with its role gate, pending refusal and abuse limit, the
 * operator pause, and tenant isolation of the delivery rows. Email goes to a
 * local stub standing in for the provider's HTTP API.
 */
describeDatabase("invitation email delivery", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  let email: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  let paused = false

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, { max: 1 })
    email = await startGoogleStub()
    server = await startAppServer({
      EMAIL_PROVIDER: "resend",
      EMAIL_API_KEY: "test-email-key",
      EMAIL_FROM: "invites@nabapresence.test",
      EMAIL_API_BASE_URL: email.baseUrl,
      // Counted only against keys this suite makes up (fresh addresses,
      // users and organisations), so nothing else sharing the database is
      // limited by it.
      ABUSE_LIMITS_ENABLED: "true",
    })
  })

  afterAll(async () => {
    await server.stop()
    await email.stop()
    await destroyTenants(admin, organisations)
    await runtime.end()
    await admin.end()
  })

  let messageId = 0
  beforeEach(() => {
    email.reset()
    respondWith(200)
  })

  afterEach(async () => {
    if (!paused) return
    await setPause(false)
    await new Promise((resolve) => setTimeout(resolve, PAUSE_PROPAGATION_MS))
  }, 20_000)

  function respondWith(status: number) {
    email.respond({ method: "POST", pathEndsWith: "/emails" }, () =>
      status === 200
        ? { status, json: { id: `email-${(messageId += 1)}` } }
        : { status, json: { message: "stubbed refusal" } }
    )
  }

  async function setPause(on: boolean) {
    paused = on
    await admin`
      select * from set_ops_pause(
        'invitation_email', ${on}, 'Integration test pause', 'invitation-delivery.test'
      )
    `
  }

  function sentTo(address: string): (SentEmail & { key: unknown })[] {
    return email.calls
      .filter((call) => call.path.endsWith("/emails"))
      .map((call) => ({
        ...(call.body as SentEmail),
        key: call.headers?.["idempotency-key"],
      }))
      .filter((body) => body.to.includes(address))
  }

  async function tenant(options: { emailOn?: boolean } = {}) {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    if (options.emailOn ?? true) {
      await admin`
        insert into organisation_feature (organisation_id, feature, enabled, changed_by)
        values (${owner.organisationId}, 'invitation_email', true, 'invitation-delivery.test')
      `
    }
    return owner
  }

  async function invite(
    owner: { cookie: string },
    address = `harness-invitee-${randomUUID()}@nabapresence.test`
  ) {
    const response = await fetch(`${server.baseUrl}/api/invitations`, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ email: address, role: "member" }),
    })
    const body = (await response.json()) as {
      inviteUrl: string
      invitation: { id: string; delivery?: Delivery | null }
    }
    expect(response.status, JSON.stringify(body)).toBe(201)
    return { address, ...body }
  }

  function resend(cookie: string, invitationId: string) {
    return fetch(`${server.baseUrl}/api/invitations/${invitationId}/resend`, {
      method: "POST",
      headers: { cookie },
    })
  }

  async function list(cookie: string) {
    const response = await fetch(`${server.baseUrl}/api/invitations`, {
      headers: { cookie },
    })
    expect(response.status).toBe(200)
    return (await response.json()) as {
      emailDelivery?: boolean
      items: { id: string; delivery?: Delivery | null }[]
    }
  }

  function deliveries(invitationId: string) {
    return admin<
      {
        id: string
        status: string
        kind: string
        attempts: number
        lastErrorCode: string | null
        nextAttemptAt: Date | null
      }[]
    >`
      select id::text as id, status, kind, attempts,
             last_error_code as "lastErrorCode",
             next_attempt_at as "nextAttemptAt"
      from invitation_delivery
      where invitation_id = ${invitationId}
      order by created_at
    `
  }

  async function jobsTick() {
    const response = await fetch(`${server.baseUrl}/api/jobs/run`, {
      method: "POST",
      headers: CRON,
    })
    expect(response.status, await response.clone().text()).toBe(200)
    return (await response.json()) as {
      invitations?: { sent: number; paused: boolean }
    }
  }

  it("leaves invitations as links to copy while the feature is off", async () => {
    const owner = await tenant({ emailOn: false })
    const created = await invite(owner)
    expect(created.invitation.delivery).toBeUndefined()
    expect(await deliveries(created.invitation.id)).toEqual([])
    expect(sentTo(created.address)).toEqual([])
    const listed = await list(owner.cookie)
    expect(listed.emailDelivery).toBe(false)
    const response = await resend(owner.cookie, created.invitation.id)
    expect(response.status).toBe(403)
    expect((await response.json()) as { error: string }).toMatchObject({
      error: "invitation_email_unavailable",
    })
  })

  it("emails the invitation link on create and shows it sent", async () => {
    const owner = await tenant()
    const created = await invite(owner)
    expect(created.invitation.delivery).toMatchObject({
      kind: "initial",
      status: "sent",
      errorCode: null,
    })
    const [sent] = sentTo(created.address)
    expect(sent.subject).toBe(
      "You're invited to join Harness tenant on NabaPresence"
    )
    // The emailed link is the one the inviter can copy, on NEXTAUTH_URL.
    expect(sent.text).toContain(created.inviteUrl)
    expect(created.inviteUrl.startsWith(server.baseUrl)).toBe(true)
    expect(sent.key).toBe(
      `invitation-delivery/${created.invitation.delivery!.id}`
    )
    const listed = await list(owner.cookie)
    expect(listed.emailDelivery).toBe(true)
    expect(
      listed.items.find((item) => item.id === created.invitation.id)?.delivery
    ).toMatchObject({ status: "sent" })
  })

  it("retries a provider 5xx with back-off and sends it on the job tick", async () => {
    const owner = await tenant()
    email.reset()
    respondWith(503)
    const created = await invite(owner)
    expect(created.invitation.delivery).toMatchObject({
      status: "pending",
      errorCode: "email_http_503",
      attempts: 1,
    })
    const [queued] = await deliveries(created.invitation.id)
    // Back-off: not due again straight away.
    expect(queued.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now())

    // Not due yet: the tick leaves it alone.
    email.reset()
    respondWith(200)
    await jobsTick()
    expect(sentTo(created.address)).toEqual([])

    await admin`
      update invitation_delivery set next_attempt_at = now() - interval '1 second'
      where id = ${queued.id}
    `
    const tick = await jobsTick()
    expect(tick.invitations?.sent).toBeGreaterThanOrEqual(1)
    const [row] = await deliveries(created.invitation.id)
    expect(row).toMatchObject({ status: "sent", attempts: 2 })
    // The retry reuses the row's idempotency key.
    expect(sentTo(created.address)[0].key).toBe(
      `invitation-delivery/${queued.id}`
    )
  })

  it("fails a provider 4xx and lets an owner resend it as a new email", async () => {
    const owner = await tenant()
    email.reset()
    respondWith(422)
    const created = await invite(owner)
    expect(created.invitation.delivery).toMatchObject({
      status: "failed",
      errorCode: "email_http_422",
    })

    email.reset()
    respondWith(200)
    const response = await resend(owner.cookie, created.invitation.id)
    expect(response.status).toBe(202)
    const body = (await response.json()) as { delivery: Delivery }
    expect(body.delivery).toMatchObject({ kind: "resend", status: "sent" })
    const rows = await deliveries(created.invitation.id)
    expect(rows.map((row) => [row.kind, row.status])).toEqual([
      ["initial", "failed"],
      ["resend", "sent"],
    ])
    expect(sentTo(created.address)[0].key).toBe(
      `invitation-delivery/${rows[1].id}`
    )
    const [audit] = await admin<{ action: string }[]>`
      select action from audit_log
      where organisation_id = ${owner.organisationId}
        and action = 'member.invitation_resent'
    `
    expect(audit).toBeDefined()
  })

  it("refuses a resend while an email is still queued, and once expired", async () => {
    const owner = await tenant()
    email.reset()
    respondWith(503)
    const created = await invite(owner)
    const pending = await resend(owner.cookie, created.invitation.id)
    expect(pending.status).toBe(409)
    expect(await pending.json()).toMatchObject({
      error: "invitation_email_pending",
    })

    await admin`
      update invitation set expires_at = now() - interval '1 minute'
      where id = ${created.invitation.id}
    `
    await admin`
      update invitation_delivery set status = 'failed', next_attempt_at = null
      where invitation_id = ${created.invitation.id}
    `
    const expired = await resend(owner.cookie, created.invitation.id)
    expect(expired.status).toBe(409)
    expect(await expired.json()).toMatchObject({ error: "invitation_expired" })
  })

  it("forbids members and viewers from resending", async () => {
    const owner = await tenant()
    const created = await invite(owner)
    for (const role of ["member", "viewer"] as const) {
      const person = await seedMemberUser(admin, {
        organisationId: owner.organisationId,
        role,
      })
      const response = await resend(person.cookie, created.invitation.id)
      expect(response.status, role).toBe(403)
    }
  })

  it("rate-limits invitation email per invitee address", async () => {
    const owner = await tenant()
    const created = await invite(owner)
    // The creation spent one of the address's five an hour.
    for (let index = 0; index < 4; index += 1) {
      const response = await resend(owner.cookie, created.invitation.id)
      expect(response.status, `resend ${index + 1}`).toBe(202)
    }
    const limited = await resend(owner.cookie, created.invitation.id)
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({
      error: "invitation_email_rate_limited",
    })
    expect(sentTo(created.address)).toHaveLength(5)

    // Over the limit, a new invitation to the same address is still made
    // (its link can be copied) and its email is recorded as not sent.
    await admin`delete from invitation where id = ${created.invitation.id}`
    const again = await invite(owner, created.address)
    expect(again.invitation.delivery).toMatchObject({
      status: "suppressed",
      errorCode: "invitation_email_rate_limited",
    })
    expect(sentTo(created.address)).toHaveLength(5)
  })

  it("spends no abuse budget on a resend refused as still pending", async () => {
    const owner = await tenant()
    email.reset()
    respondWith(503)
    // The creation spends one of the address's five an hour.
    const created = await invite(owner)
    expect(created.invitation.delivery).toMatchObject({ status: "pending" })
    for (let index = 0; index < 5; index += 1) {
      const refused = await resend(owner.cookie, created.invitation.id)
      expect(refused.status, `resend ${index + 1}`).toBe(409)
    }
    await admin`
      update invitation_delivery set status = 'failed', next_attempt_at = null
      where invitation_id = ${created.invitation.id}
    `
    email.reset()
    respondWith(200)
    // Had the five refusals counted, this would be the sixth and answer 429.
    const response = await resend(owner.cookie, created.invitation.id)
    expect(response.status).toBe(202)
    expect(sentTo(created.address)).toHaveLength(1)
  })

  it("stops queued and retrying email once the feature is turned off", async () => {
    const owner = await tenant()
    email.reset()
    respondWith(503)
    const created = await invite(owner)
    expect(created.invitation.delivery).toMatchObject({ status: "pending" })

    await admin`
      update organisation_feature set enabled = false
      where organisation_id = ${owner.organisationId}
        and feature = 'invitation_email'
    `
    await admin`
      update invitation_delivery set next_attempt_at = now() - interval '1 second'
      where invitation_id = ${created.invitation.id}
    `
    email.reset()
    respondWith(200)
    await jobsTick()
    expect(sentTo(created.address)).toEqual([])
    const [row] = await deliveries(created.invitation.id)
    expect(row).toMatchObject({
      status: "suppressed",
      lastErrorCode: "invitation_email_disabled",
      nextAttemptAt: null,
    })
  })

  it("holds invitation email while the invitation_email scope is paused", async () => {
    const owner = await tenant()
    await setPause(true)
    await new Promise((resolve) => setTimeout(resolve, PAUSE_PROPAGATION_MS))
    const created = await invite(owner)
    expect(created.invitation.delivery).toMatchObject({
      status: "pending",
      attempts: 0,
    })
    await admin`
      update invitation_delivery set next_attempt_at = now() - interval '1 second'
      where invitation_id = ${created.invitation.id}
    `
    const tick = await jobsTick()
    expect(tick.invitations).toBeUndefined()
    expect(sentTo(created.address)).toEqual([])

    await setPause(false)
    await new Promise((resolve) => setTimeout(resolve, PAUSE_PROPAGATION_MS))
    await jobsTick()
    const [row] = await deliveries(created.invitation.id)
    expect(row.status).toBe("sent")
    expect(sentTo(created.address)).toHaveLength(1)
  }, 30_000)

  it("keeps delivery rows inside their organisation", async () => {
    const first = await tenant()
    const second = await tenant()
    const created = await invite(first)
    const [row] = await deliveries(created.invitation.id)

    await runtime.begin(async (sql) => {
      await sql`select set_config('app.organisation_id', ${second.organisationId}, true)`
      const visible = await sql`
        select id from invitation_delivery where id = ${row.id}
      `
      expect(visible).toHaveLength(0)
      const updated = await sql`
        update invitation_delivery set status = 'failed' where id = ${row.id}
        returning id
      `
      expect(updated).toHaveLength(0)
    })
    // A row naming another organisation's invitation is refused whatever
    // the writer's tenant: RLS on the organisation, the composite key on
    // the invitation.
    await expect(
      runtime.begin(async (sql) => {
        await sql`select set_config('app.organisation_id', ${second.organisationId}, true)`
        await sql`
          insert into invitation_delivery (organisation_id, invitation_id)
          values (${second.organisationId}, ${created.invitation.id})
        `
      })
    ).rejects.toMatchObject({ code: "23503" })

    const [still] = await deliveries(created.invitation.id)
    expect(still.status).toBe("sent")

    // Revoking the invitation takes its deliveries with it.
    const revoked = await fetch(
      `${server.baseUrl}/api/invitations/${created.invitation.id}`,
      { method: "DELETE", headers: { cookie: first.cookie } }
    )
    expect(revoked.status).toBe(200)
    expect(await deliveries(created.invitation.id)).toEqual([])
  })
})
