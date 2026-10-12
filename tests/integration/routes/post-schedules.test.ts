import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"

import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  occurrencesResponseSchema,
  scheduleResponseSchema,
  schedulesResponseSchema,
  type PublicationSchedule,
} from "@/lib/contracts/publication-schedules"
import {
  resolveLocalSlot,
  scheduledPublishIntentId,
} from "@/lib/domain/publication-schedule"
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
const sha256Hex = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex")
const CRON = { authorization: "Bearer route-harness-cron-secret" }

// The tenant helper keeps its copy private and seeds no refresh token; the
// slow-token case needs one (same format as connection-failures.test.ts).
function encryptHarnessSecret(value: string) {
  const key = createHash("sha256")
    .update(
      process.env.TOKEN_ENCRYPTION_KEY ??
        "route-harness-token-key-32-characters!!",
      "utf8"
    )
    .digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ])
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext])
}

/**
 * WP7 end to end: real routes, the real job tick, owned PostgreSQL and a
 * loopback Google stub. Time passing is simulated by moving an occurrence's
 * intended instant into the past; nothing else is faked.
 */
describeDatabase("scheduled post publication", { timeout: 60_000 }, () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  const state = {
    posts: [] as Array<Record<string, unknown>>,
    createStatus: 200,
    listStatus: 200,
    // Runs while the publish request is in flight (before Google answers).
    onCreate: null as null | (() => Promise<void>),
  }
  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    google = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      // Only the slow-token case refreshes a token.
      GOOGLE_CLIENT_ID: "post-schedules-client",
      GOOGLE_CLIENT_SECRET: "post-schedules-secret",
      GBP_POSTS_ENABLED: "true",
      PUBLISH_ENABLED: "true",
      JOBS_ENABLED: "true",
      // Applies only to organisations whose own flag is on: every tenant
      // here is a pilot with it off, except the billing hold case.
      BILLING_ENFORCEMENT_ENABLED: "true",
    })
  })
  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })
  beforeEach(() => {
    state.posts = []
    state.createStatus = 200
    state.listStatus = 200
    state.onCreate = null
    google.reset()
    google.respond(
      { method: "POST", pathIncludes: "/localPosts" },
      async (call) => {
        if (state.onCreate) await state.onCreate()
        const path = new URL(call.path, "https://stub.test").pathname.replace(
          /^\/v4\//,
          ""
        )
        const post = {
          ...(call.body as object),
          name: `${path}/p${state.posts.length + 1}`,
          state: "LIVE",
        }
        if (state.createStatus === 200) state.posts.push(post)
        return {
          status: state.createStatus,
          json:
            state.createStatus === 200
              ? post
              : { error: { status: "UNAVAILABLE" } },
        }
      }
    )
    google.respond({ method: "GET", pathIncludes: "/localPosts?" }, () => ({
      status: state.listStatus,
      json:
        state.listStatus === 200
          ? { localPosts: state.posts }
          : { error: { status: "UNAVAILABLE" } },
    }))
    google.respond({ method: "GET", pathIncludes: "/localPosts/" }, (call) => {
      const found = state.posts.find((post) =>
        call.path.includes(String(post.name))
      )
      return found
        ? { status: 200, json: found }
        : { status: 404, json: { error: { status: "NOT_FOUND" } } }
    })
  })
  const creates = () =>
    google.calls.filter(
      (call) => call.method === "POST" && call.path.includes("/localPosts")
    )
  const tick = async () => {
    const response = await fetch(`${server.baseUrl}/api/jobs/run`, {
      method: "POST",
      headers: CRON,
    })
    expect(response.status, await response.clone().text()).toBe(200)
    return response.json() as Promise<{ schedules?: Record<string, number> }>
  }

  // Scheduling is an organisation feature (P08-R1); repeating rules need
  // their own on top. Most cases here exercise main's engine, so both are on.
  const setFeature = (
    organisationId: string,
    feature: "post_scheduling" | "post_scheduling_recurring",
    enabled: boolean
  ) => admin`
    insert into organisation_feature (organisation_id, feature, enabled, changed_by)
    values (${organisationId}, ${feature}, ${enabled}, 'post-schedules test')
    on conflict (organisation_id, feature) do update set enabled = excluded.enabled`

  async function tenant(
    features: Array<"post_scheduling" | "post_scheduling_recurring"> = [
      "post_scheduling",
      "post_scheduling_recurring",
    ]
  ) {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    for (const feature of features)
      await setFeature(owner.organisationId, feature, true)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      ...connection,
    })
    const api = (path: string, init: RequestInit = {}, cookie = owner.cookie) =>
      fetch(`${server.baseUrl}/api/locations/${linked.locationId}${path}`, {
        ...init,
        headers: { cookie, "content-type": "application/json" },
      })
    async function draft(
      body: Record<string, unknown> = {
        topicType: "STANDARD",
        languageCode: "en-GB",
        summary: "Sunday roast is back",
        media: [],
      }
    ) {
      const response = await api("/posts", {
        method: "POST",
        body: JSON.stringify(body),
      })
      expect(response.status, await response.clone().text()).toBe(201)
      return (await response.json()).post.id as string
    }
    async function schedule(
      postId: string,
      rule: Record<string, unknown>,
      extra: Record<string, unknown> = {},
      cookie = owner.cookie
    ) {
      const response = await api(
        "/post-schedules",
        {
          method: "POST",
          body: JSON.stringify({
            postId,
            rule,
            timezone: "Europe/London",
            ...extra,
          }),
        },
        cookie
      )
      expect(response.status, await response.clone().text()).toBe(200)
      return scheduleResponseSchema.parse(await response.json()).schedule
    }
    const approve = (s: PublicationSchedule, cookie = owner.cookie) =>
      api(
        `/post-schedules/${s.id}/approve`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedPayloadHash: s.payloadHash,
            revision: s.revision,
          }),
        },
        cookie
      )
    const occurrences = (scheduleId: string) => admin<
      {
        id: string
        status: string
        status_reason: string | null
        intended_at: Date
        post_id: string | null
      }[]
    >`
      select id::text as id, status, status_reason, intended_at, post_id::text as post_id from post_publication_occurrence where schedule_id = ${scheduleId} order by intended_at`
    // Moves an occurrence's intended instant `minutesAgo` minutes into the
    // past; 0117's trigger moves its deadline (intended + 5 minutes) with it.
    const age = (occurrenceId: string, minutesAgo: number) =>
      admin`update post_publication_occurrence set intended_at = now() - make_interval(secs => ${minutesAgo * 60}) where id = ${occurrenceId}`
    const scheduleRow = async (id: string) =>
      (
        await admin<
          { status: string; status_reason: string | null }[]
        >`select status, status_reason from post_publication_schedule where id = ${id}`
      )[0]
    return {
      owner,
      connection,
      linked,
      api,
      draft,
      schedule,
      approve,
      occurrences,
      age,
      scheduleRow,
    }
  }
  // The migration file carries its own begin/commit, which postgres.js only
  // accepts on a reserved connection.
  const runMigration = async (text: string) => {
    const connection = await admin.reserve()
    try {
      await connection.unsafe(text)
    } finally {
      connection.release()
    }
  }
  const tomorrow = () =>
    new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const inDays = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

  it("publishes an approved one-time schedule exactly once despite repeated and concurrent ticks", async () => {
    const t = await tenant(),
      s = await t.schedule(await t.draft(), {
        frequency: "once",
        startDate: tomorrow(),
        localTime: "09:00",
      })
    expect(s).toMatchObject({
      status: "awaiting_approval",
      preview: { total: 1 },
    })
    await tick()
    expect(creates()).toHaveLength(0)
    expect((await t.approve(s)).status).toBe(200)
    const [occurrence] = await t.occurrences(s.id)
    expect(occurrence.status).toBe("scheduled")
    await t.age(occurrence.id, 2)
    await Promise.all([tick(), tick(), tick()])
    await tick()
    expect(creates()).toHaveLength(1)
    const [done] = await t.occurrences(s.id)
    expect(done).toMatchObject({ status: "published" })
    expect(await t.scheduleRow(s.id)).toMatchObject({ status: "completed" })
    const [post] =
      await admin`select status, google_post_name, summary from gbp_local_post where id = ${done.post_id}`
    expect(post).toMatchObject({
      status: "published",
      summary: "Sunday roast is back",
    })
    // The publish ran under the occurrence's deterministic intent, so it has
    // exactly one receipt (P08-R3), recorded as the approver's write.
    const receipts = await admin`
      select m.state, m.surface, m.approval_ref, m.actor_user_id::text as actor, m.connection_generation
      from mutation_operation m join post_publication_occurrence o
        on o.organisation_id = m.organisation_id and o.intent_id = m.intent_id
      where o.id = ${done.id}`
    expect(receipts).toEqual([
      {
        state: "confirmed_applied",
        surface: "local_post",
        approval_ref: `post_schedule:${s.id}:1`,
        actor: t.owner.userId,
        connection_generation: 1,
      },
    ])
    // The scheduled dispatch records the approval's assurance (0106).
    const [attempt] = await admin<
      { actor: string; aal: string | null; version: number | null }[]
    >`
      select actor_user_id::text as actor, authorised_aal as aal,
        authorised_security_version as version
      from gbp_local_post_attempt where post_id = ${done.post_id}`
    expect(attempt).toEqual({ actor: t.owner.userId, aal: "aal1", version: 1 })
    // ...which approval froze on the schedule.
    const [approval] = await admin<
      { aal: string | null; version: number | null }[]
    >`select approved_aal as aal, approved_security_version as version
      from post_publication_schedule where id = ${s.id}`
    expect(approval).toEqual({ aal: "aal1", version: 1 })
  })

  it("blocks without publishing when the approver was recovered after approving", async () => {
    const t = await tenant()
    const s = await t.schedule(await t.draft(), {
      frequency: "once",
      startDate: tomorrow(),
      localTime: "09:00",
    })
    expect((await t.approve(s)).status).toBe(200)
    // Operator MFA recovery (recover_user_mfa) bumps the version, so the
    // dispatch recheck (recheckAuthorisation) no longer matches the version
    // the approval recorded.
    await admin`update app_user set security_version = security_version + 1 where id = ${t.owner.userId}`
    const [occurrence] = await t.occurrences(s.id)
    await t.age(occurrence.id, 1)
    const summary = await tick()
    expect(summary.schedules).toMatchObject({ blocked: 1 })
    expect(await t.scheduleRow(s.id)).toEqual({
      status: "blocked",
      status_reason: "approval_invalid",
    })
    expect(creates()).toHaveLength(0)
    const receipts = await admin`
      select 1 from mutation_operation where organisation_id = ${t.owner.organisationId} and surface = 'local_post'`
    expect(receipts).toHaveLength(0)
    const incidents = await admin<{ reason: string }[]>`
      select reason from notification_incident where organisation_id = ${t.owner.organisationId} and kind = 'schedule_blocked'`
    expect(incidents.map((incident) => incident.reason)).toEqual([
      "approval_invalid",
    ])
  })

  it("holds an approved schedule while billing is read-only and publishes once restored inside the window", async () => {
    const t = await tenant(),
      s = await t.schedule(await t.draft(), {
        frequency: "once",
        startDate: tomorrow(),
        localTime: "09:00",
      })
    expect((await t.approve(s)).status).toBe(200)
    await admin`update organisation_billing set state = 'read_only', enforcement_enabled = true where organisation_id = ${t.owner.organisationId}`
    const [occurrence] = await t.occurrences(s.id)
    await t.age(occurrence.id, 1)
    const held = await tick()
    expect(held.schedules).toMatchObject({ readOnly: 1, blocked: 0 })
    expect(creates()).toHaveLength(0)
    // Nothing was claimed or recorded: no receipt, no attempt.
    expect(
      await admin`select 1 from mutation_operation where organisation_id = ${t.owner.organisationId} and surface = 'local_post'`
    ).toHaveLength(0)
    // Re-checked every tick, but the incident's subject is the held
    // occurrence, so later ticks update this one open incident (the
    // notification_incident upsert) rather than open another per tick.
    await tick()
    const incidents = await admin<{ reason: string; subject_id: string }[]>`select reason, subject_id from notification_incident where organisation_id = ${t.owner.organisationId} and kind = 'schedule_blocked'`
    expect(incidents).toHaveLength(1)
    expect(incidents[0].reason).toBe("billing_read_only")
    expect(incidents[0].subject_id).toContain(`schedule_occurrence:${occurrence.id}`)
    expect((await t.occurrences(s.id))[0].status).toBe("scheduled")
    expect(await t.scheduleRow(s.id)).toMatchObject({ status: "active" })
    await admin`update organisation_billing set state = 'pilot' where organisation_id = ${t.owner.organisationId}`
    await tick()
    expect(creates()).toHaveLength(1)
    expect((await t.occurrences(s.id))[0]).toMatchObject({ status: "published" })
  })

  it("records a slot missed, never published late, when billing stays read-only past its window", async () => {
    const t = await tenant(),
      s = await t.schedule(await t.draft(), {
        frequency: "once",
        startDate: tomorrow(),
        localTime: "09:00",
      })
    expect((await t.approve(s)).status).toBe(200)
    await admin`update organisation_billing set state = 'read_only', enforcement_enabled = true where organisation_id = ${t.owner.organisationId}`
    const [occurrence] = await t.occurrences(s.id)
    await t.age(occurrence.id, 1)
    await tick()
    expect(creates()).toHaveLength(0)
    // The window closes while the subscription is still read-only.
    await t.age(occurrence.id, 6)
    await tick()
    expect((await t.occurrences(s.id))[0]).toMatchObject({
      status: "missed",
      status_reason: "outside_dispatch_window",
    })
    expect(await t.scheduleRow(s.id)).toEqual({
      status: "needs_review",
      status_reason: "outside_dispatch_window",
    })
    // Restoring billing does not publish the passed slot.
    await admin`update organisation_billing set state = 'pilot' where organisation_id = ${t.owner.organisationId}`
    await tick()
    expect(creates()).toHaveLength(0)
  })

  it("ignores a read-only record while the organisation's own enforcement flag is off", async () => {
    const t = await tenant(),
      s = await t.schedule(await t.draft(), {
        frequency: "once",
        startDate: tomorrow(),
        localTime: "09:00",
      })
    expect((await t.approve(s)).status).toBe(200)
    // Rollout: BILLING_ENFORCEMENT_ENABLED is on for the server, but this
    // organisation's enforcement_enabled is not, so nothing is held.
    await admin`update organisation_billing set state = 'read_only', enforcement_enabled = false where organisation_id = ${t.owner.organisationId}`
    const [occurrence] = await t.occurrences(s.id)
    await t.age(occurrence.id, 1)
    const summary = await tick()
    expect(summary.schedules).toMatchObject({ readOnly: 0 })
    expect(creates()).toHaveLength(1)
    expect((await t.occurrences(s.id))[0]).toMatchObject({ status: "published" })
  })

  it("requires a different approver under two-person policy and invalidates approval when content is edited", async () => {
    const t = await tenant()
    await admin`update organisation set require_two_person_approval = true where id = ${t.owner.organisationId}`
    const s = await t.schedule(await t.draft(), {
      frequency: "daily",
      startDate: tomorrow(),
      localTime: "10:00",
      end: { type: "count", count: 3 },
    })
    expect(s.canApprove).toBe(false)
    const self = await t.approve(s)
    expect(self.status).toBe(409)
    expect(await self.json()).toMatchObject({
      error: "second_approver_required",
    })
    const manager = await seedMemberUser(admin, {
      organisationId: t.owner.organisationId,
      canPublish: true,
    })
    await admin`update member set role = 'admin' where user_id = ${manager.userId}`
    expect((await t.approve(s, manager.cookie)).status).toBe(200)
    expect((await t.occurrences(s.id)).map((o) => o.status)).toEqual([
      "scheduled",
      "scheduled",
      "scheduled",
    ])
    // The assurance it was approved with (0106): MFA is off here, so aal1.
    const assuranceOf = async () =>
      (
        await admin<
          {
            aal: string | null
            verifiedAt: Date | null
            version: number | null
          }[]
        >`
          select approved_aal as aal,
            approved_mfa_verified_at as "verifiedAt",
            approved_security_version as version
          from post_publication_schedule where id = ${s.id}
        `
      )[0]
    expect(await assuranceOf()).toEqual({
      aal: "aal1",
      verifiedAt: null,
      version: 1,
    })
    const revised = await t.api(`/post-schedules/${s.id}`, {
      method: "PUT",
      body: JSON.stringify({
        rule: {
          frequency: "daily",
          startDate: tomorrow(),
          localTime: "11:00",
          end: { type: "count", count: 2 },
        },
        timezone: "Europe/London",
      }),
    })
    expect(revised.status, await revised.clone().text()).toBe(200)
    const next = scheduleResponseSchema.parse(await revised.json()).schedule
    expect(next).toMatchObject({
      status: "awaiting_approval",
      revision: 2,
      approvedBy: null,
    })
    expect(await assuranceOf()).toEqual({
      aal: null,
      verifiedAt: null,
      version: null,
    })
    expect(
      (await t.occurrences(s.id)).map((o) => `${o.status}:${o.status_reason}`)
    ).toEqual([
      "cancelled:approval_invalidated",
      "cancelled:approval_invalidated",
      "cancelled:approval_invalidated",
    ])
    const stale = await t.approve(s, manager.cookie)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: "approval_stale" })
  })

  it("blocks without publishing when the policy changes or the approver loses access after approval", async () => {
    const t = await tenant()
    const policy = await t.schedule(await t.draft(), {
      frequency: "once",
      startDate: tomorrow(),
      localTime: "09:00",
    })
    await t.approve(policy)
    await admin`update organisation set require_two_person_approval = true where id = ${t.owner.organisationId}`
    await t.age((await t.occurrences(policy.id))[0].id, 2)
    await tick()
    expect(await t.scheduleRow(policy.id)).toEqual({
      status: "blocked",
      status_reason: "approval_invalid",
    })
    await admin`update organisation set require_two_person_approval = false where id = ${t.owner.organisationId}`
    const manager = await seedMemberUser(admin, {
      organisationId: t.owner.organisationId,
      canPublish: true,
    })
    await admin`update member set role = 'admin' where user_id = ${manager.userId}`
    const revoked = await t.schedule(await t.draft(), {
      frequency: "once",
      startDate: tomorrow(),
      localTime: "09:00",
    })
    await t.approve(revoked, manager.cookie)
    await admin`update member set role = 'viewer', can_publish = false where user_id = ${manager.userId}`
    await t.age((await t.occurrences(revoked.id))[0].id, 2)
    await tick()
    expect(await t.scheduleRow(revoked.id)).toEqual({
      status: "blocked",
      status_reason: "permission_revoked",
    })
    expect(creates()).toHaveLength(0)
    const incidents =
      await admin`select kind, reason from notification_incident where organisation_id = ${t.owner.organisationId} and kind = 'schedule_blocked' order by opened_at`
    expect(incidents.map((row) => row.reason)).toEqual([
      "approval_invalid",
      "permission_revoked",
    ])
  })

  it("publishes only inside the 5-minute window and records anything later as missed", async () => {
    const t = await tenant(),
      s = await t.schedule(await t.draft(), {
        frequency: "daily",
        startDate: tomorrow(),
        localTime: "09:00",
        end: { type: "count", count: 4 },
      })
    await t.approve(s)
    const [first, second, third] = await t.occurrences(s.id)
    await t.age(first.id, 50 * 60)
    await t.age(second.id, 6)
    await t.age(third.id, 2)
    await tick()
    const after = await t.occurrences(s.id)
    expect(after.map((o) => `${o.status}:${o.status_reason ?? ""}`)).toEqual([
      "missed:outside_dispatch_window",
      "missed:outside_dispatch_window",
      "published:",
      "scheduled:",
    ])
    expect(creates()).toHaveLength(1)
    const missed =
      await admin`select reason from notification_incident where organisation_id = ${t.owner.organisationId} and kind = 'schedule_missed'`
    expect(missed.map((row) => row.reason)).toEqual([
      "outside_dispatch_window",
      "outside_dispatch_window",
    ])
    await tick()
    expect(creates()).toHaveLength(1)
  })

  it("refuses at the provider call when the window closed while the publish was being prepared", async () => {
    const t = await tenant(),
      s = await t.schedule(await t.draft(), {
        frequency: "once",
        startDate: tomorrow(),
        localTime: "09:00",
      })
    await t.approve(s)
    // The access token has expired, so the publish refreshes it inside
    // mutate, immediately before the provider call; Google's token endpoint
    // answers only after the slot's window has closed.
    await admin`
      update google_connection set refresh_token_ciphertext = ${encryptHarnessSecret("stub-refresh-token")},
        access_token_expires_at = now() - interval '1 hour'
      where id = ${t.connection.connectionId}`
    google.respond({ method: "POST", pathEndsWith: "/token" }, () => ({
      status: 200,
      delayMs: 7_000,
      json: {
        access_token: "late-access-token",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/business.manage",
        token_type: "Bearer",
      },
    }))
    const [slot] = await t.occurrences(s.id)
    // Its deadline is 4 seconds away: the claim and the check before
    // anything is written pass; the one inside mutate does not.
    await t.age(slot.id, 296 / 60)
    await tick()
    expect(
      google.calls.filter((call) => call.path.endsWith("/token"))
    ).toHaveLength(1)
    expect(creates()).toHaveLength(0)
    const receipts = await admin<
      { state: string; error_code: string | null; surface: string }[]
    >`
      select state, error_code, surface from mutation_operation
      where organisation_id = ${t.owner.organisationId}`
    expect(receipts).toEqual([
      {
        state: "failed",
        error_code: "schedule_deadline_passed",
        surface: "local_post",
      },
    ])
    expect((await t.occurrences(s.id))[0]).toMatchObject({
      status: "missed",
      status_reason: "outside_dispatch_window",
    })
    expect(await t.scheduleRow(s.id)).toEqual({
      status: "needs_review",
      status_reason: "outside_dispatch_window",
    })
    await tick()
    expect(creates()).toHaveLength(0)
  })

  it("never settles a scheduled publish from another write that took its intent", async () => {
    const t = await tenant(),
      s = await t.schedule(await t.draft(), {
        frequency: "once",
        startDate: tomorrow(),
        localTime: "09:00",
      })
    await t.approve(s)
    const [slot] = await t.occurrences(s.id)
    // A member who read the occurrence id sends its intent first, as the
    // Idempotency-Key of an hours update that Google confirmed.
    await admin`
      insert into mutation_operation (organisation_id, intent_id, surface, action, location_id, target_ref, payload_hash, state)
      values (${t.owner.organisationId}, ${scheduledPublishIntentId(slot.id, sha256Hex)}, 'hours', 'update',
        ${t.linked.locationId}, ${t.linked.locationId}, ${"b".repeat(64)}, 'confirmed_applied')`
    await t.age(slot.id, 1)
    await tick()
    // The publish was refused (intent_conflict) with nothing sent, and the
    // hours receipt is not read as this occurrence's publish.
    expect(creates()).toHaveLength(0)
    expect((await t.occurrences(s.id))[0]).toMatchObject({
      status: "scheduled",
    })
    await t.age(slot.id, 6)
    await tick()
    expect((await t.occurrences(s.id))[0]).toMatchObject({
      status: "missed",
      status_reason: "outside_dispatch_window",
    })
    expect(await t.scheduleRow(s.id)).toEqual({
      status: "needs_review",
      status_reason: "outside_dispatch_window",
    })
    expect(creates()).toHaveLength(0)
  })

  it("records a one-time slot missed while publishing is paused, and never publishes it late", async () => {
    const t = await tenant(),
      s = await t.schedule(await t.draft(), {
        frequency: "once",
        startDate: tomorrow(),
        localTime: "09:00",
      })
    await t.approve(s)
    // The whole job runner is paused, so the tick claims nothing at all;
    // the sweep still runs. The app caches the pause table for 5 seconds.
    const settlePauses = () =>
      new Promise((resolve) => setTimeout(resolve, 5_300))
    await admin`
      update ops_pause_control set paused = true, reason = 'post-schedules test', changed_by = 'post-schedules test'
      where scope = 'jobs'`
    await settlePauses()
    try {
      await t.age((await t.occurrences(s.id))[0].id, 6)
      await tick()
      expect((await t.occurrences(s.id))[0]).toMatchObject({
        status: "missed",
        status_reason: "outside_dispatch_window",
      })
      expect(await t.scheduleRow(s.id)).toEqual({
        status: "needs_review",
        status_reason: "outside_dispatch_window",
      })
    } finally {
      await admin`update ops_pause_control set paused = false where scope = 'jobs'`
      await settlePauses()
    }
    await tick()
    expect(creates()).toHaveLength(0)
  })

  it("does not publish an expired event late", async () => {
    const t = await tenant()
    const yesterday = new Date(Date.now() - 86_400_000)
    const day = {
      year: yesterday.getUTCFullYear(),
      month: yesterday.getUTCMonth() + 1,
      day: yesterday.getUTCDate(),
    }
    const post = await t.draft({
      topicType: "EVENT",
      languageCode: "en-GB",
      summary: "Quiz night",
      media: [],
      event: {
        title: "Quiz night",
        schedule: { startDate: day, endDate: day },
      },
    })
    const s = await t.schedule(post, {
      frequency: "once",
      startDate: tomorrow(),
      localTime: "09:00",
    })
    await t.approve(s)
    await t.age((await t.occurrences(s.id))[0].id, 2)
    await tick()
    expect((await t.occurrences(s.id))[0]).toMatchObject({
      status: "missed",
      status_reason: "expired_content",
    })
    expect(creates()).toHaveLength(0)
  })

  it("keeps an uncertain publication blocked, resolves it from its receipt and never re-creates it", async () => {
    const t = await tenant(),
      s = await t.schedule(await t.draft(), {
        frequency: "daily",
        startDate: tomorrow(),
        localTime: "09:00",
        end: { type: "count", count: 3 },
      })
    await t.approve(s)
    const [first, second] = await t.occurrences(s.id)
    await t.age(first.id, 1)
    // The create lands at Google, but neither its answer nor the list can
    // be read.
    state.listStatus = 503
    google.respond(
      { method: "POST", pathIncludes: "/localPosts" },
      async (call) => {
        const path = new URL(call.path, "https://stub.test").pathname.replace(
          /^\/v4\//,
          ""
        )
        state.posts.push({
          ...(call.body as object),
          name: `${path}/p${state.posts.length + 1}`,
          state: "LIVE",
        })
        return { status: 503, json: { error: { status: "UNAVAILABLE" } } }
      }
    )
    await tick()
    expect((await t.occurrences(s.id))[0]).toMatchObject({
      status: "ambiguous",
      status_reason: "response_ambiguous",
    })
    expect(await t.scheduleRow(s.id)).toEqual({
      status: "blocked",
      status_reason: "prior_occurrence_unresolved",
    })
    const [receipt] = await admin<{ id: string; state: string }[]>`
      select m.id::text as id, m.state from mutation_operation m join post_publication_occurrence o
        on o.organisation_id = m.organisation_id and o.intent_id = m.intent_id
      where o.id = ${first.id}`
    expect(receipt.state).toBe("uncertain")
    // Blocked: nothing more is sent, the next occurrence included.
    await t.age(second.id, 1)
    await tick()
    expect(creates()).toHaveLength(1)
    expect((await t.occurrences(s.id))[1].status).toBe("scheduled")

    // Google is readable again; mutation_recover reads it back (its first
    // readback is brought forward here instead of waiting two minutes).
    // Meanwhile the second occurrence's window closes while the schedule is
    // blocked.
    await t.age(second.id, 6)
    state.listStatus = 200
    await admin`update mutation_operation set next_recovery_at = now() - interval '1 second' where id = ${receipt.id}`
    await tick()
    const [recovered] =
      await admin`select state from mutation_operation where id = ${receipt.id}`
    expect(recovered.state).toBe("awaiting_confirmation")
    // The next tick's sweep settles the occurrence from the receipt and
    // unblocks the schedule; the second occurrence is missed, not caught up.
    await tick()
    const rows = new Map(
      (await t.occurrences(s.id)).map((o) => [
        o.id,
        `${o.status}:${o.status_reason ?? ""}`,
      ])
    )
    expect(rows.get(first.id)).toBe("published:")
    expect(rows.get(second.id)).toBe("missed:outside_dispatch_window")
    expect([...rows.values()]).toContain("scheduled:")
    expect(await t.scheduleRow(s.id)).toEqual({
      status: "active",
      status_reason: null,
    })
    // Resolved, never re-created.
    expect(creates()).toHaveLength(1)
  })

  it("blocks a schedule whose Google link was moved or reconnected after approval", async () => {
    const t = await tenant()
    const once = {
      frequency: "once",
      startDate: tomorrow(),
      localTime: "09:00",
    }
    const reconnected = await t.schedule(await t.draft(), once)
    expect((await t.approve(reconnected)).status).toBe(200)
    await admin`update google_connection set credential_generation = credential_generation + 1 where id = ${t.connection.connectionId}`
    await t.age((await t.occurrences(reconnected.id))[0].id, 2)
    await tick()
    expect(await t.scheduleRow(reconnected.id)).toEqual({
      status: "blocked",
      status_reason: "connection_changed",
    })

    const relinked = await t.schedule(await t.draft(), once)
    expect((await t.approve(relinked)).status).toBe(200)
    const other = await seedGoogleConnection(admin, {
      organisationId: t.owner.organisationId,
    })
    await admin`
      update external_location set google_connection_id = ${other.connectionId}, google_account_name = ${other.googleAccountName}
      where id = ${t.linked.externalLocationId}`
    await t.age((await t.occurrences(relinked.id))[0].id, 2)
    await tick()
    expect(await t.scheduleRow(relinked.id)).toEqual({
      status: "blocked",
      status_reason: "connection_changed",
    })
    expect(creates()).toHaveLength(0)
    const incidents =
      await admin`select reason from notification_incident where organisation_id = ${t.owner.organisationId} and kind = 'schedule_blocked'`
    expect(incidents.map((row) => row.reason)).toEqual([
      "connection_changed",
      "connection_changed",
    ])
  })

  it("records slots that came due while paused as missed, needs a new time instead of resuming, and cancels", async () => {
    const t = await tenant()
    const act = (id: string, action: string) =>
      t.api(`/post-schedules/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      })
    const repeating = await t.schedule(await t.draft(), {
      frequency: "weekly",
      startDate: tomorrow(),
      localTime: "12:00",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      end: { type: "date", date: inDays(8) },
    })
    await t.approve(repeating)
    const before = await t.occurrences(repeating.id)
    expect((await act(repeating.id, "pause")).status).toBe(200)
    await t.age(before[0].id, 6)
    await tick()
    expect((await t.occurrences(repeating.id))[0]).toMatchObject({
      status: "missed",
      status_reason: "paused_when_due",
    })
    // A repeating schedule resumes with its next occurrence; the missed one
    // is not caught up.
    expect((await act(repeating.id, "resume")).status).toBe(200)
    await tick()
    expect(creates()).toHaveLength(0)

    const single = await t.schedule(await t.draft(), {
      frequency: "once",
      startDate: tomorrow(),
      localTime: "12:00",
    })
    await t.approve(single)
    expect((await act(single.id, "pause")).status).toBe(200)
    await t.age((await t.occurrences(single.id))[0].id, 6)
    await tick()
    expect(await t.scheduleRow(single.id)).toEqual({
      status: "needs_review",
      status_reason: "paused_when_due",
    })
    const resumed = await act(single.id, "resume")
    expect(resumed.status).toBe(409)
    expect(await resumed.json()).toMatchObject({ error: "schedule_missed" })
    expect(creates()).toHaveLength(0)
    const missed =
      await admin`select reason from notification_incident where organisation_id = ${t.owner.organisationId} and kind = 'schedule_missed'`
    expect(missed.map((row) => row.reason)).toEqual([
      "paused_when_due",
      "paused_when_due",
    ])

    const cancelled = await act(repeating.id, "cancel")
    expect(
      scheduleResponseSchema.parse(await cancelled.json()).schedule.status
    ).toBe("cancelled")
    const after = await t.occurrences(repeating.id)
    expect(after).toHaveLength(before.length)
    expect(after.filter((o) => o.status === "scheduled")).toHaveLength(0)
  })

  it("lists calendar occurrences only for locations the viewer can see", async () => {
    const t = await tenant(),
      other = await seedLinkedLocation(admin, {
        organisationId: t.owner.organisationId,
        ...t.connection,
      })
    const s = await t.schedule(await t.draft(), {
      frequency: "once",
      startDate: tomorrow(),
      localTime: "09:00",
    })
    await t.approve(s)
    const member = await seedMemberUser(admin, {
      organisationId: t.owner.organisationId,
      assignLocationId: other.locationId,
    })
    const window = new URLSearchParams({
      from: new Date().toISOString(),
      to: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    })
    const owner = occurrencesResponseSchema.parse(
      await (
        await fetch(
          `${server.baseUrl}/api/post-schedules/occurrences?${window}`,
          { headers: { cookie: t.owner.cookie } }
        )
      ).json()
    )
    expect(owner.occurrences.map((o) => o.scheduleId)).toContain(s.id)
    const scoped = occurrencesResponseSchema.parse(
      await (
        await fetch(
          `${server.baseUrl}/api/post-schedules/occurrences?${window}`,
          { headers: { cookie: member.cookie } }
        )
      ).json()
    )
    expect(scoped.occurrences.map((o) => o.scheduleId)).not.toContain(s.id)
  })
  it("refuses to schedule while post_scheduling is off, blocks a due schedule, and keeps listing, pausing and cancelling", async () => {
    const t = await tenant(["post_scheduling"])
    const once = (time: string) => ({
      frequency: "once",
      startDate: tomorrow(),
      localTime: time,
    })
    const pending = await t.schedule(await t.draft(), once("09:00"))
    const pausable = await t.schedule(await t.draft(), once("10:00"))
    const due = await t.schedule(await t.draft(), once("11:00"))
    expect((await t.approve(pausable)).status).toBe(200)
    expect((await t.approve(due)).status).toBe(200)
    await setFeature(t.owner.organisationId, "post_scheduling", false)
    const refused = async (response: Response, status = 404) => {
      expect(response.status, await response.clone().text()).toBe(status)
      expect(await response.json()).toMatchObject({
        error: "post_scheduling_unavailable",
      })
    }

    await t.age((await t.occurrences(due.id))[0].id, 2)
    await tick()
    expect(await t.scheduleRow(due.id)).toEqual({
      status: "blocked",
      status_reason: "feature_disabled",
    })
    expect(creates()).toHaveLength(0)
    const [incident] =
      await admin`select reason from notification_incident where organisation_id = ${t.owner.organisationId} and kind = 'schedule_blocked'`
    expect(incident?.reason).toBe("feature_disabled")

    await refused(
      await t.api("/post-schedules", {
        method: "POST",
        body: JSON.stringify({
          postId: await t.draft(),
          rule: once("12:00"),
          timezone: "Europe/London",
        }),
      })
    )
    await refused(await t.approve(pending))
    await refused(
      await t.api(`/post-schedules/${pending.id}`, {
        method: "PUT",
        body: JSON.stringify({
          rule: once("13:00"),
          timezone: "Europe/London",
        }),
      })
    )
    await refused(
      await fetch(
        `${server.baseUrl}/api/post-schedules/occurrences?${new URLSearchParams(
          {
            from: new Date().toISOString(),
            to: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          }
        )}`,
        { headers: { cookie: t.owner.cookie } }
      )
    )
    const act = (id: string, action: string) =>
      t.api(`/post-schedules/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      })
    expect((await act(pausable.id, "pause")).status).toBe(200)
    await refused(await act(pausable.id, "resume"))

    const listed = await t.api("/post-schedules")
    expect(listed.status).toBe(200)
    const { schedules } = (await listed.json()) as {
      schedules: PublicationSchedule[]
    }
    expect(schedules.map((row) => row.id).sort()).toEqual(
      [pending.id, pausable.id, due.id].sort()
    )
    const cancelled = await act(pending.id, "cancel")
    expect(cancelled.status).toBe(200)
    expect(
      scheduleResponseSchema.parse(await cancelled.json()).schedule.status
    ).toBe("cancelled")
    expect(creates()).toHaveLength(0)
  })

  it("schedules once by default and needs post_scheduling_recurring for a repeating rule", async () => {
    const t = await tenant(["post_scheduling"])
    const daily = {
      frequency: "daily",
      startDate: tomorrow(),
      localTime: "09:00",
      end: { type: "count", count: 2 },
    }
    const refused = await t.api("/post-schedules", {
      method: "POST",
      body: JSON.stringify({
        postId: await t.draft(),
        rule: daily,
        timezone: "Europe/London",
      }),
    })
    expect(refused.status, await refused.clone().text()).toBe(422)
    expect(await refused.json()).toMatchObject({
      error: "schedule_recurring_unavailable",
    })
    const once = await t.schedule(await t.draft(), {
      frequency: "once",
      startDate: tomorrow(),
      localTime: "09:00",
    })
    expect(once.status).toBe("awaiting_approval")

    // Approved while repeating schedules were on, due after they went off.
    await setFeature(t.owner.organisationId, "post_scheduling_recurring", true)
    const repeating = await t.schedule(await t.draft(), daily)
    expect((await t.approve(repeating)).status).toBe(200)
    await setFeature(t.owner.organisationId, "post_scheduling_recurring", false)
    await t.age((await t.occurrences(repeating.id))[0].id, 2)
    await tick()
    expect(await t.scheduleRow(repeating.id)).toEqual({
      status: "blocked",
      status_reason: "recurring_disabled",
    })
    expect(creates()).toHaveLength(0)
    const reapproval = await t.api(`/post-schedules/${repeating.id}`, {
      method: "PUT",
      body: JSON.stringify({ rule: daily, timezone: "Europe/London" }),
    })
    expect(reapproval.status).toBe(422)
    const single = await t.api(`/post-schedules/${repeating.id}`, {
      method: "PUT",
      body: JSON.stringify({
        rule: { frequency: "once", startDate: inDays(2), localTime: "09:00" },
        timezone: "Europe/London",
      }),
    })
    expect(single.status, await single.clone().text()).toBe(200)
    expect(
      scheduleResponseSchema.parse(await single.json()).schedule
    ).toMatchObject({ status: "awaiting_approval", revision: 2 })
  })

  /** The next last Sunday of `month` (0-based) strictly after today, in UTC. */
  const nextLastSunday = (month: number) => {
    const now = new Date()
    for (const year of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
      const last = new Date(Date.UTC(year, month + 1, 0))
      const sunday = new Date(last.getTime() - last.getUTCDay() * 86_400_000)
      if (sunday.getTime() > now.getTime() + 86_400_000)
        return sunday.toISOString().slice(0, 10)
    }
    throw new Error("no last Sunday")
  }
  /** A repeated local time 1 to 89 days ahead in one of a few zones, if any. */
  const ambiguousSlotWithinWindow = () => {
    const zones = [
      "Europe/London",
      "America/New_York",
      "Australia/Sydney",
      "America/Santiago",
      "Australia/Lord_Howe",
    ]
    for (let day = 1; day < 90; day += 1)
      for (const timezone of zones)
        for (const localTime of ["00:30", "01:30", "01:45", "02:30", "23:30"]) {
          const startDate = inDays(day)
          const slot = resolveLocalSlot(startDate, localTime, timezone)
          if (slot.kind === "ambiguous")
            return { startDate, localTime, timezone, slot }
        }
    return null
  }

  it("refuses nonexistent and unresolved repeated local times and books an explicit offset (P08-R2)", async () => {
    const t = await tenant(["post_scheduling"])
    const create = (body: Record<string, unknown>) =>
      t.api("/post-schedules", {
        method: "POST",
        body: JSON.stringify({ timezone: "Europe/London", ...body }),
      })
    const postId = await t.draft()
    // London's spring-forward gap: 01:30 never happens that day. The time
    // check comes before the window, so the date may be months away.
    const gap = await create({
      postId,
      rule: {
        frequency: "once",
        startDate: nextLastSunday(2),
        localTime: "01:30",
      },
    })
    expect(gap.status, await gap.clone().text()).toBe(422)
    expect(await gap.json()).toMatchObject({
      error: "schedule_time_nonexistent",
    })
    const repeated = await create({
      postId,
      rule: {
        frequency: "once",
        startDate: nextLastSunday(9),
        localTime: "01:30",
      },
    })
    expect(repeated.status).toBe(422)
    expect(await repeated.json()).toMatchObject({
      error: "schedule_time_ambiguous",
    })
    const wrongOffset = await create({
      postId,
      rule: { frequency: "once", startDate: inDays(3), localTime: "09:00" },
      offsetMinutes: 180,
    })
    expect(wrongOffset.status).toBe(422)
    expect(await wrongOffset.json()).toMatchObject({
      error: "schedule_offset_invalid",
    })
    const daily = await create({
      postId,
      rule: {
        frequency: "daily",
        startDate: inDays(3),
        localTime: "09:00",
        end: { type: "count", count: 2 },
      },
      offsetMinutes: 0,
    })
    // Repeating rules are off here, and the feature check comes first.
    expect(daily.status).toBe(422)
    expect(creates()).toHaveLength(0)

    const found = ambiguousSlotWithinWindow()
    if (!found) return // No clock change in the next 90 days in these zones.
    const later = found.slot.choices[1]
    const choices = await create({
      postId,
      rule: {
        frequency: "once",
        startDate: found.startDate,
        localTime: found.localTime,
      },
      timezone: found.timezone,
    })
    expect(choices.status).toBe(422)
    expect(await choices.json()).toMatchObject({
      error: "schedule_time_ambiguous",
      details: {
        choices: found.slot.choices.map((choice) => ({
          offsetMinutes: choice.offsetMinutes,
          intendedAt: choice.instant.toISOString(),
        })),
      },
    })
    const s = await t.schedule(
      postId,
      {
        frequency: "once",
        startDate: found.startDate,
        localTime: found.localTime,
      },
      { timezone: found.timezone, offsetMinutes: later.offsetMinutes }
    )
    expect(s).toMatchObject({
      offsetMinutes: later.offsetMinutes,
      preview: {
        total: 1,
        problem: null,
        first: [{ intendedAt: later.instant.toISOString() }],
      },
    })
    expect((await t.approve(s)).status).toBe(200)
    const [row] = await admin<
      { intended_at: Date; deadline_at: Date; offset_minutes: number }[]
    >`
      select o.intended_at, o.deadline_at, s.offset_minutes from post_publication_occurrence o
      join post_publication_schedule s on s.id = o.schedule_id where o.schedule_id = ${s.id}`
    expect(row.intended_at.toISOString()).toBe(later.instant.toISOString())
    expect(row.deadline_at.getTime() - row.intended_at.getTime()).toBe(
      5 * 60_000
    )
    expect(row.offset_minutes).toBe(later.offsetMinutes)
  })

  it("keeps a one-time slot 5 minutes to 90 days ahead at create, revise and approve (P08-R2)", async () => {
    const t = await tenant(["post_scheduling"])
    const utc = (offsetMs: number) => {
      const at = new Date(Date.now() + offsetMs).toISOString()
      return {
        frequency: "once",
        startDate: at.slice(0, 10),
        localTime: at.slice(11, 16),
      }
    }
    const create = (rule: Record<string, unknown>) =>
      t.api("/post-schedules", {
        method: "POST",
        body: JSON.stringify({ postId: postId, rule, timezone: "UTC" }),
      })
    const postId = await t.draft()
    const soon = await create(utc(2 * 60_000))
    expect(soon.status).toBe(422)
    expect(await soon.json()).toMatchObject({ error: "schedule_too_soon" })
    const far = await create(utc(91 * 86_400_000))
    expect(far.status).toBe(422)
    expect(await far.json()).toMatchObject({ error: "schedule_too_far" })
    const s = await t.schedule(postId, utc(2 * 86_400_000), {
      timezone: "UTC",
    })
    expect(s).toMatchObject({ offsetMinutes: 0, preview: { problem: null } })

    const revise = (rule: Record<string, unknown>) =>
      t.api(`/post-schedules/${s.id}`, {
        method: "PUT",
        body: JSON.stringify({ rule, timezone: "UTC" }),
      })
    const revisedSoon = await revise(utc(60_000))
    expect(revisedSoon.status).toBe(422)
    expect(await revisedSoon.json()).toMatchObject({
      error: "schedule_too_soon",
    })
    const revisedGap = await t.api(`/post-schedules/${s.id}`, {
      method: "PUT",
      body: JSON.stringify({
        rule: {
          frequency: "once",
          startDate: nextLastSunday(2),
          localTime: "01:30",
        },
        timezone: "Europe/London",
      }),
    })
    expect(revisedGap.status).toBe(422)
    expect(await revisedGap.json()).toMatchObject({
      error: "schedule_time_nonexistent",
    })

    // Time passes between request and approval: the stored slot is now 2
    // minutes away, so approval is refused and nothing is materialised.
    await admin`update post_publication_schedule set rule = ${admin.json(utc(2 * 60_000))} where id = ${s.id}`
    const listed = (await (await t.api("/post-schedules")).json()) as {
      schedules: PublicationSchedule[]
    }
    expect(listed.schedules.find((row) => row.id === s.id)).toMatchObject({
      preview: { total: 0, problem: "schedule_too_soon" },
    })
    const late = await t.approve(s)
    expect(late.status).toBe(409)
    expect(await late.json()).toMatchObject({ error: "schedule_too_soon" })

    // A row from before 0117 with a repeated time and no stored offset needs
    // a new revision; approval never guesses the earlier instant.
    await admin`update post_publication_schedule set offset_minutes = null, timezone = 'Europe/London',
      rule = ${admin.json({ frequency: "once", startDate: nextLastSunday(9), localTime: "01:30" })} where id = ${s.id}`
    const guessed = await t.approve(s)
    expect(guessed.status).toBe(409)
    expect(await guessed.json()).toMatchObject({
      error: "schedule_time_ambiguous",
    })
    expect(await t.occurrences(s.id)).toHaveLength(0)
    expect(creates()).toHaveLength(0)
  })

  it("approves a one-time schedule from before 0117 with its offset, and an unchanged resubmit is no change (P08-R2)", async () => {
    const t = await tenant(["post_scheduling"])
    const rule = { frequency: "once", startDate: inDays(3), localTime: "09:00" }
    const s = await t.schedule(await t.draft(), rule)
    const slot = resolveLocalSlot(
      rule.startDate,
      rule.localTime,
      "Europe/London"
    )
    if (slot.kind !== "ok") throw new Error("expected a single 09:00")
    // As stored before 0117: no offset, and a hash that never covered one.
    await admin`update post_publication_schedule set offset_minutes = null where id = ${s.id}`
    const approved = await t.approve(s)
    expect(approved.status, await approved.clone().text()).toBe(200)
    expect(
      scheduleResponseSchema.parse(await approved.json()).schedule
    ).toMatchObject({
      status: "active",
      offsetMinutes: slot.offsetMinutes,
      payloadHash: s.payloadHash,
      preview: { total: 1, problem: null },
    })
    const [stored] = await admin<
      { offset_minutes: number | null; payload_hash: string }[]
    >`select offset_minutes, payload_hash from post_publication_schedule where id = ${s.id}`
    expect(stored).toEqual({
      offset_minutes: slot.offsetMinutes,
      payload_hash: s.payloadHash,
    })

    // The sheet sends no offset for a time that happens once; the server
    // resolves the stored one, and the approved hash still matches.
    const resubmit = await t.api(`/post-schedules/${s.id}`, {
      method: "PUT",
      body: JSON.stringify({ rule, timezone: "Europe/London" }),
    })
    expect(resubmit.status).toBe(409)
    expect(await resubmit.json()).toMatchObject({ error: "schedule_no_change" })
    const explicit = await t.api(`/post-schedules/${s.id}`, {
      method: "PUT",
      body: JSON.stringify({
        rule,
        timezone: "Europe/London",
        offsetMinutes: slot.offsetMinutes,
      }),
    })
    expect(explicit.status).toBe(409)
    expect(await t.scheduleRow(s.id)).toEqual({
      status: "active",
      status_reason: null,
    })
    expect((await t.occurrences(s.id)).map((o) => o.status)).toEqual([
      "scheduled",
    ])
  })

  it("keeps a draft edit when the schedule_blocked event it raises cannot be stored (P08-R6 review)", async () => {
    const t = await tenant(["post_scheduling"])
    const body = {
      topicType: "STANDARD",
      languageCode: "en-GB",
      summary: "Quiz night is back",
      media: [],
    }
    const postId = await t.draft(body)
    const s = await t.schedule(postId, {
      frequency: "once",
      startDate: tomorrow(),
      localTime: "09:00",
    })
    expect((await t.approve(s)).status).toBe(200)
    // The incident insert fails with a SQL error inside the edit's own
    // transaction (only for this organisation, so no other test sees it).
    const org = t.owner.organisationId
    await admin.unsafe(`
      create or replace function test_refuse_schedule_blocked() returns trigger
      language plpgsql as $f$
      begin
        if new.kind = 'schedule_blocked' and new.organisation_id = '${org}' then
          raise exception 'refused for the test';
        end if;
        return new;
      end $f$;
      create trigger refuse_schedule_blocked before insert on notification_incident
        for each row execute function test_refuse_schedule_blocked();`)
    try {
      const edited = await t.api(`/posts/${postId}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...body,
          summary: "Quiz night, now fortnightly",
        }),
      })
      expect(edited.status, await edited.clone().text()).toBe(200)
    } finally {
      await admin.unsafe(`
        drop trigger if exists refuse_schedule_blocked on notification_incident;
        drop function if exists test_refuse_schedule_blocked();`)
    }
    // The edit, the re-freeze and its audit row all landed; only the event
    // was rolled back (and logged).
    const [post] = await admin<{ summary: string }[]>`
      select summary from gbp_local_post where id = ${postId}`
    expect(post.summary).toBe("Quiz night, now fortnightly")
    expect(await t.scheduleRow(s.id)).toEqual({
      status: "awaiting_approval",
      status_reason: "source_changed",
    })
    const audited = await admin<{ id: string }[]>`
      select id::text as id from audit_log
      where organisation_id = ${org} and action = 'post_schedule.source_changed' and subject_id = ${s.id}`
    expect(audited).toHaveLength(1)
    expect(
      await admin`select 1 from notification_incident where organisation_id = ${org} and kind = 'schedule_blocked'`
    ).toHaveLength(0)
  })

  it("re-freezes an approved schedule when its draft is edited and publishes the draft itself at the approved revision (P08-R4)", async () => {
    const t = await tenant(["post_scheduling"])
    const body = {
      topicType: "STANDARD",
      languageCode: "en-GB",
      summary: "Sunday roast is back",
      media: [],
    }
    const postId = await t.draft(body)
    const s = await t.schedule(postId, {
      frequency: "once",
      startDate: tomorrow(),
      localTime: "09:00",
    })
    const [{ revision: frozen }] = await admin<{ revision: number }[]>`
      select content_revision::int as revision from gbp_local_post where id = ${postId}`
    expect(s.sourceContentRevision).toBe(frozen)
    expect((await t.approve(s)).status).toBe(200)
    const edit = (summary: string) =>
      t.api(`/posts/${postId}`, {
        method: "PATCH",
        body: JSON.stringify({ ...body, summary }),
      })

    // Saving the same text changes no revision, so the approval stands.
    expect((await edit("Sunday roast is back")).status).toBe(200)
    expect(await t.scheduleRow(s.id)).toEqual({
      status: "active",
      status_reason: null,
    })

    // An edit re-freezes the schedule from the new text, in the edit's own
    // transaction, as a new revision that needs approving again.
    const edited = await edit("Roast and sticky toffee pudding")
    expect(edited.status, await edited.clone().text()).toBe(200)
    expect(await t.scheduleRow(s.id)).toEqual({
      status: "awaiting_approval",
      status_reason: "source_changed",
    })
    expect(
      (await t.occurrences(s.id)).map((o) => `${o.status}:${o.status_reason}`)
    ).toEqual(["cancelled:source_changed"])
    const stale = await t.approve(s)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: "approval_stale" })
    const listed = schedulesResponseSchema
      .parse(await (await t.api("/post-schedules")).json())
      .schedules.find((row) => row.id === s.id)!
    expect(listed).toMatchObject({
      revision: 2,
      sourceContentRevision: frozen + 1,
      template: { summary: "Roast and sticky toffee pudding" },
    })
    expect(listed.payloadHash).not.toBe(s.payloadHash)

    // Approved again, the occurrence publishes the draft itself, at exactly
    // the approved revision: no second copy of the post is left behind.
    expect((await t.approve(listed)).status).toBe(200)
    const slot = (await t.occurrences(s.id)).find(
      (o) => o.status === "scheduled"
    )!
    await t.age(slot.id, 1)
    await tick()
    expect(creates()).toHaveLength(1)
    expect(creates()[0].body).toMatchObject({
      summary: "Roast and sticky toffee pudding",
    })
    expect(
      (await t.occurrences(s.id)).find((o) => o.id === slot.id)
    ).toMatchObject({ status: "published", post_id: postId })
    const posts = await admin<
      { id: string; status: string; revision: number }[]
    >`
      select id::text as id, status, content_revision::int as revision from gbp_local_post
      where organisation_id = ${t.owner.organisationId}`
    expect(posts).toEqual([
      { id: postId, status: "published", revision: frozen + 1 },
    ])
    const [receipt] = await admin<
      { state: string; target_ref: string; expected_revision: string }[]
    >`
      select m.state, m.target_ref, m.expected_revision from mutation_operation m
      join post_publication_occurrence o on o.organisation_id = m.organisation_id and o.intent_id = m.intent_id
      where o.id = ${slot.id}`
    expect(receipt).toEqual({
      state: "confirmed_applied",
      target_ref: postId,
      expected_revision: String(frozen + 1),
    })
    expect(await t.scheduleRow(s.id)).toMatchObject({ status: "completed" })
  })

  it("never publishes a draft changed some other way, and supersedes one published first (P08-R4)", async () => {
    const t = await tenant(["post_scheduling"])
    const rule = {
      frequency: "once",
      startDate: tomorrow(),
      localTime: "09:00",
    }

    // Waiting: approval refuses text the request did not freeze.
    const waitingPost = await t.draft()
    const waiting = await t.schedule(waitingPost, rule)
    await admin`update gbp_local_post set summary = 'Changed underneath' where id = ${waitingPost}`
    const refused = await t.approve(waiting)
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({
      error: "schedule_source_changed",
    })

    // Approved: the runner finds the change, re-freezes and sends nothing.
    const changedPost = await t.draft()
    const changed = await t.schedule(changedPost, rule)
    expect((await t.approve(changed)).status).toBe(200)
    await admin`update gbp_local_post set summary = 'Changed underneath' where id = ${changedPost}`
    const [changedSlot] = await t.occurrences(changed.id)
    await t.age(changedSlot.id, 1)
    // A re-freeze is counted as such, not as a block.
    expect((await tick()).schedules).toMatchObject({
      sourceChanged: 1,
      blocked: 0,
    })
    expect(creates()).toHaveLength(0)
    expect(await t.scheduleRow(changed.id)).toEqual({
      status: "awaiting_approval",
      status_reason: "source_changed",
    })
    expect((await t.occurrences(changed.id))[0]).toMatchObject({
      status: "cancelled",
      status_reason: "source_changed",
    })

    // A draft publishes once, so it takes one live one-time schedule.
    const second = await t.api("/post-schedules", {
      method: "POST",
      body: JSON.stringify({
        postId: changedPost,
        rule,
        timezone: "Europe/London",
      }),
    })
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({
      error: "schedule_source_already_scheduled",
    })

    // Published by hand first: the occurrence is superseded, not re-sent.
    const publishedPost = await t.draft()
    const published = await t.schedule(publishedPost, rule)
    expect((await t.approve(published)).status).toBe(200)
    const now = await t.api(`/posts/${publishedPost}/publish`, {
      method: "POST",
    })
    expect(now.status, await now.clone().text()).toBe(200)
    expect(creates()).toHaveLength(1)
    const [publishedSlot] = await t.occurrences(published.id)
    await t.age(publishedSlot.id, 1)
    await tick()
    expect(creates()).toHaveLength(1)
    expect((await t.occurrences(published.id))[0]).toMatchObject({
      status: "cancelled",
      status_reason: "source_superseded",
    })
    expect(await t.scheduleRow(published.id)).toEqual({
      status: "cancelled",
      status_reason: "source_superseded",
    })
    // The approvers of each approved publication that will no longer run
    // are told why (P08-R6); the one still waiting for approval raised none.
    const told = await admin<{ reason: string; scheduleId: string }[]>`
      select reason, summary -> 'source' ->> 'scheduleId' as "scheduleId"
      from notification_incident
      where organisation_id = ${t.owner.organisationId} and kind = 'schedule_blocked'
      order by reason`
    expect(told).toEqual([
      { reason: "source_changed", scheduleId: changed.id },
      { reason: "source_superseded", scheduleId: published.id },
    ])

    // And a draft already on Google cannot be scheduled once.
    const again = await t.api("/post-schedules", {
      method: "POST",
      body: JSON.stringify({
        postId: publishedPost,
        rule,
        timezone: "Europe/London",
      }),
    })
    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({
      error: "schedule_source_unavailable",
    })
  })

  it("leaves a one-time slot scheduled while its draft is being published by hand, and publishes it if that publish fails (P08-R4)", async () => {
    const t = await tenant(["post_scheduling"])
    const postId = await t.draft()
    const s = await t.schedule(postId, {
      frequency: "once",
      startDate: tomorrow(),
      localTime: "09:00",
    })
    expect((await t.approve(s)).status).toBe(200)
    const [slot] = await t.occurrences(s.id)
    await t.age(slot.id, 1)

    // A manual publish in flight, then one whose outcome is unresolved:
    // neither is an end state, so nothing is sent and nothing is superseded.
    for (const status of ["publishing", "ambiguous"]) {
      await admin`update gbp_local_post set status = ${status}, google_post_name = null where id = ${postId}`
      const summary = await tick()
      expect(summary.schedules).toMatchObject({ superseded: 0 })
      expect(creates()).toHaveLength(0)
      expect((await t.occurrences(s.id))[0]).toMatchObject({
        status: "scheduled",
        status_reason: null,
      })
      expect(await t.scheduleRow(s.id)).toEqual({
        status: "active",
        status_reason: null,
      })
    }

    // That publish failed for good: the draft is publishable again and the
    // approved slot, still inside its window, publishes it once.
    await admin`update gbp_local_post set status = 'failed' where id = ${postId}`
    await tick()
    expect(creates()).toHaveLength(1)
    expect((await t.occurrences(s.id))[0]).toMatchObject({
      status: "published",
      post_id: postId,
    })
    expect(await t.scheduleRow(s.id)).toMatchObject({ status: "completed" })
  })

  it("refuses at publish a draft changed after the occurrence was claimed, and re-freezes the schedule (P08-R4)", async () => {
    const t = await tenant(["post_scheduling"])
    const postId = await t.draft()
    const s = await t.schedule(postId, {
      frequency: "once",
      startDate: tomorrow(),
      localTime: "09:00",
    })
    expect((await t.approve(s)).status).toBe(200)
    const [slot] = await t.occurrences(s.id)
    // The draft changes in the claim's own transaction, after the runner
    // checked its revision: the publish reads the edited row and must refuse
    // it before anything is recorded or sent.
    const name = `test_edit_on_claim_${slot.id.replaceAll("-", "")}`
    await admin.unsafe(`
      create function ${name}() returns trigger language plpgsql as $$
      begin
        update gbp_local_post set summary = 'Edited after the claim' where id = '${postId}';
        return new;
      end $$;
      create trigger ${name} after update of status on post_publication_occurrence
        for each row when (new.id = '${slot.id}' and new.status = 'publishing')
        execute function ${name}();`)
    try {
      await t.age(slot.id, 1)
      const summary = await tick()
      expect(summary.schedules).toMatchObject({ sourceChanged: 1, blocked: 0 })
    } finally {
      await admin.unsafe(
        `drop trigger if exists ${name} on post_publication_occurrence; drop function if exists ${name}();`
      )
    }
    expect(creates()).toHaveLength(0)
    expect(
      await admin`select 1 from mutation_operation where organisation_id = ${t.owner.organisationId}`
    ).toHaveLength(0)
    expect((await t.occurrences(s.id))[0]).toMatchObject({
      status: "cancelled",
      status_reason: "source_changed",
    })
    expect(await t.scheduleRow(s.id)).toEqual({
      status: "awaiting_approval",
      status_reason: "source_changed",
    })
    const listed = schedulesResponseSchema
      .parse(await (await t.api("/post-schedules")).json())
      .schedules.find((row) => row.id === s.id)!
    expect(listed).toMatchObject({
      revision: 2,
      template: { summary: "Edited after the claim" },
    })
    await tick()
    expect(creates()).toHaveLength(0)
  })

  it("keeps one live one-time schedule per draft under concurrent requests (P08-R4)", async () => {
    const t = await tenant(["post_scheduling"])
    const postId = await t.draft()
    const body = JSON.stringify({
      postId,
      rule: { frequency: "once", startDate: tomorrow(), localTime: "09:00" },
      timezone: "Europe/London",
    })
    const responses = await Promise.all(
      [1, 2, 3, 4].map(() => t.api("/post-schedules", { method: "POST", body }))
    )
    const statuses = responses.map((response) => response.status).sort()
    expect(statuses).toEqual([200, 409, 409, 409])
    for (const response of responses.filter((r) => r.status === 409))
      expect(await response.json()).toMatchObject({
        error: "schedule_source_already_scheduled",
      })
    expect(
      await admin`select 1 from post_publication_schedule where source_post_id = ${postId}`
    ).toHaveLength(1)
  })

  it("keeps a paused or blocked schedule so when its draft is edited, and asks for approval on resume (P08-R4)", async () => {
    const t = await tenant(["post_scheduling"])
    const body = {
      topicType: "STANDARD",
      languageCode: "en-GB",
      summary: "Sunday roast is back",
      media: [],
    }
    const rule = {
      frequency: "once",
      startDate: tomorrow(),
      localTime: "09:00",
    }
    const edit = (postId: string, summary: string) =>
      t.api(`/posts/${postId}`, {
        method: "PATCH",
        body: JSON.stringify({ ...body, summary }),
      })
    const act = (id: string, action: string) =>
      t.api(`/post-schedules/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      })
    const listed = async (id: string) =>
      schedulesResponseSchema
        .parse(await (await t.api("/post-schedules")).json())
        .schedules.find((row) => row.id === id)!

    // Paused by a manager: the pause stands, the approval does not.
    const pausedPost = await t.draft(body)
    const paused = await t.schedule(pausedPost, rule)
    expect((await t.approve(paused)).status).toBe(200)
    expect((await act(paused.id, "pause")).status).toBe(200)
    expect((await edit(pausedPost, "Roast and pudding")).status).toBe(200)
    expect(await t.scheduleRow(paused.id)).toEqual({
      status: "paused",
      status_reason: "source_changed",
    })
    expect((await t.occurrences(paused.id))[0]).toMatchObject({
      status: "cancelled",
      status_reason: "source_changed",
    })
    const refrozen = await listed(paused.id)
    expect(refrozen).toMatchObject({
      revision: 2,
      approvedBy: null,
      canApprove: false,
      template: { summary: "Roast and pudding" },
    })
    // Resuming asks for the approval the edit cleared; only that makes it
    // active again.
    expect((await act(paused.id, "resume")).status).toBe(200)
    expect(await t.scheduleRow(paused.id)).toEqual({
      status: "awaiting_approval",
      status_reason: "source_changed",
    })
    expect((await t.approve(await listed(paused.id))).status).toBe(200)
    expect(await t.scheduleRow(paused.id)).toEqual({
      status: "active",
      status_reason: null,
    })

    // Blocked (the feature went off when it came due): the block and its
    // reason stand.
    const blockedPost = await t.draft(body)
    const blocked = await t.schedule(blockedPost, rule)
    expect((await t.approve(blocked)).status).toBe(200)
    await setFeature(t.owner.organisationId, "post_scheduling", false)
    await t.age((await t.occurrences(blocked.id))[0].id, 1)
    await tick()
    expect(await t.scheduleRow(blocked.id)).toEqual({
      status: "blocked",
      status_reason: "feature_disabled",
    })
    await setFeature(t.owner.organisationId, "post_scheduling", true)
    expect((await edit(blockedPost, "Roast and pudding")).status).toBe(200)
    expect(await t.scheduleRow(blocked.id)).toEqual({
      status: "blocked",
      status_reason: "feature_disabled",
    })
    expect(await listed(blocked.id)).toMatchObject({
      revision: 2,
      approvedBy: null,
      template: { summary: "Roast and pudding" },
    })
    expect(creates()).toHaveLength(0)
  })

  it("lists old per-post times for review, lets a manager dismiss one and closes another when its post is scheduled (P08-R5)", async () => {
    const t = await tenant(["post_scheduling"])
    const dismissPost = await t.draft()
    const schedulePost = await t.draft({
      topicType: "STANDARD",
      languageCode: "en-GB",
      summary: "Bonfire night",
      media: [],
    })
    // The runtime cannot insert these (0116 copies them); the operator can.
    const [dismissRow] = await admin<{ id: string }[]>`
      insert into gbp_local_post_legacy_schedule (organisation_id, location_id, post_id, scheduled_publish_time, recurrence)
      values (${t.owner.organisationId}, ${t.linked.locationId}, ${dismissPost}, now() + interval '3 days', '{"frequency":"WEEKLY"}'::jsonb)
      returning id::text as id`
    const [scheduleRow] = await admin<{ id: string }[]>`
      insert into gbp_local_post_legacy_schedule (organisation_id, location_id, post_id, scheduled_publish_time)
      values (${t.owner.organisationId}, ${t.linked.locationId}, ${schedulePost}, now() + interval '4 days')
      returning id::text as id`
    const legacyApi = (
      path = "",
      init: RequestInit = {},
      cookie = t.owner.cookie
    ) =>
      fetch(
        `${server.baseUrl}/api/locations/${t.linked.locationId}/legacy-post-schedules${path}`,
        { ...init, headers: { cookie, "content-type": "application/json" } }
      )

    const listed = await legacyApi()
    expect(listed.status, await listed.clone().text()).toBe(200)
    const body = (await listed.json()) as {
      legacySchedules: Array<Record<string, unknown>>
    }
    expect(body.legacySchedules).toEqual([
      expect.objectContaining({
        id: dismissRow.id,
        postId: dismissPost,
        repeats: true,
        schedulable: true,
      }),
      expect.objectContaining({
        id: scheduleRow.id,
        postId: schedulePost,
        summary: "Bonfire night",
        repeats: false,
      }),
    ])

    // A member may see the location but neither list nor dismiss old times.
    const member = await seedMemberUser(admin, {
      organisationId: t.owner.organisationId,
    })
    expect((await legacyApi("", {}, member.cookie)).status).toBe(403)
    const refused = await legacyApi(
      `/${dismissRow.id}`,
      { method: "PATCH", body: JSON.stringify({ action: "dismiss" }) },
      member.cookie
    )
    expect(refused.status).toBe(403)

    const dismissed = await legacyApi(`/${dismissRow.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "dismiss" }),
    })
    expect(dismissed.status, await dismissed.clone().text()).toBe(200)
    // Dismissing again is the same answer.
    expect(
      (
        await legacyApi(`/${dismissRow.id}`, {
          method: "PATCH",
          body: JSON.stringify({ action: "dismiss" }),
        })
      ).status
    ).toBe(200)

    // Scheduling the other post properly closes its review.
    await t.schedule(schedulePost, {
      frequency: "once",
      startDate: tomorrow(),
      localTime: "09:00",
    })
    const rows = await admin<
      { id: string; status: string; reviewed_by: string | null }[]
    >`select id::text as id, status, reviewed_by::text as reviewed_by from gbp_local_post_legacy_schedule where organisation_id = ${t.owner.organisationId} order by scheduled_publish_time`
    expect(rows).toEqual([
      { id: dismissRow.id, status: "dismissed", reviewed_by: t.owner.userId },
      { id: scheduleRow.id, status: "dismissed", reviewed_by: t.owner.userId },
    ])
    const audits = await admin<{ outcome: string }[]>`
      select metadata ->> 'outcome' as outcome from audit_log
      where organisation_id = ${t.owner.organisationId} and action = 'post_schedule.legacy_reviewed'
      order by created_at`
    expect(audits.map((row) => row.outcome)).toEqual(["dismissed", "scheduled"])
    expect(
      ((await (await legacyApi()).json()) as { legacySchedules: unknown[] })
        .legacySchedules
    ).toEqual([])
    // Nothing was sent or created.
    expect(creates()).toHaveLength(0)

    // Part of the scheduling surface: switched off, it is not there.
    await setFeature(t.owner.organisationId, "post_scheduling", false)
    expect((await legacyApi()).status).toBe(404)
    expect(
      (
        await legacyApi(`/${scheduleRow.id}`, {
          method: "PATCH",
          body: JSON.stringify({ action: "dismiss" }),
        })
      ).status
    ).toBe(404)
  })

  it("leaves an old per-post time open when a member requests the schedule, and closes it when a manager approves (P08-R5 review)", async () => {
    const t = await tenant(["post_scheduling"])
    const postId = await t.draft()
    const [legacyRow] = await admin<{ id: string }[]>`
      insert into gbp_local_post_legacy_schedule (organisation_id, location_id, post_id, scheduled_publish_time)
      values (${t.owner.organisationId}, ${t.linked.locationId}, ${postId}, now() + interval '3 days')
      returning id::text as id`
    const legacyRows = () =>
      admin<{ status: string; reviewed_by: string | null }[]>`
        select status, reviewed_by::text as reviewed_by from gbp_local_post_legacy_schedule where id = ${legacyRow.id}`
    const listLegacy = async () => {
      const response = await fetch(
        `${server.baseUrl}/api/locations/${t.linked.locationId}/legacy-post-schedules`,
        { headers: { cookie: t.owner.cookie } }
      )
      expect(response.status).toBe(200)
      return (
        (await response.json()) as {
          legacySchedules: Array<Record<string, unknown>>
        }
      ).legacySchedules
    }

    const editor = await seedMemberUser(admin, {
      organisationId: t.owner.organisationId,
    })
    const requested = await t.schedule(
      postId,
      { frequency: "once", startDate: tomorrow(), localTime: "09:00" },
      {},
      editor.cookie
    )
    expect(requested.status).toBe("awaiting_approval")
    // A member's request is not the owner's review: the old time stays open,
    // but the post cannot be scheduled from it a second time.
    expect(await legacyRows()).toEqual([
      { status: "needs_review", reviewed_by: null },
    ])
    expect(await listLegacy()).toEqual([
      expect.objectContaining({
        id: legacyRow.id,
        schedulable: false,
        alreadyScheduled: true,
      }),
    ])

    expect((await t.approve(requested)).status).toBe(200)
    expect(await legacyRows()).toEqual([
      { status: "dismissed", reviewed_by: t.owner.userId },
    ])
    const audits = await admin<{ actor: string; outcome: string }[]>`
      select actor_user_id::text as actor, metadata ->> 'outcome' as outcome from audit_log
      where organisation_id = ${t.owner.organisationId} and action = 'post_schedule.legacy_reviewed'`
    expect(audits).toEqual([{ actor: t.owner.userId, outcome: "scheduled" }])
    expect(await listLegacy()).toEqual([])
    expect(creates()).toHaveLength(0)
  })

  // Last: re-running 0116 touches every tenant's rows in this database.
  it("0116 quarantines live repeating schedules and legacy post times, and creates no work", async () => {
    const t = await tenant()
    const repeating = await t.schedule(await t.draft(), {
      frequency: "weekly",
      startDate: tomorrow(),
      localTime: "09:00",
      end: { type: "count", count: 3 },
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    })
    expect((await t.approve(repeating)).status).toBe(200)
    const single = await t.schedule(await t.draft(), {
      frequency: "once",
      startDate: tomorrow(),
      localTime: "10:00",
    })
    expect((await t.approve(single)).status).toBe(200)
    const legacyPost = await t.draft()
    await admin`update gbp_local_post set scheduled_publish_time = now() + interval '3 days' where id = ${legacyPost}`
    // Work here is an occurrence row or a post row; the migration adds neither.
    const work = async () =>
      (
        await admin<{ occurrences: number; posts: number }[]>`
          select (select count(*)::int from post_publication_occurrence where organisation_id = ${t.owner.organisationId}) as occurrences,
            (select count(*)::int from gbp_local_post where organisation_id = ${t.owner.organisationId}) as posts`
      )[0]
    const workBefore = await work()

    const migration = await readFile(
      new URL(
        "../../../supabase/migrations/0116_post_schedule_quarantine.sql",
        import.meta.url
      ),
      "utf8"
    )
    await runMigration(migration)

    expect(await t.scheduleRow(repeating.id)).toEqual({
      status: "needs_review",
      status_reason: "recurring_quarantined",
    })
    expect(
      (await t.occurrences(repeating.id)).map(
        (o) => `${o.status}:${o.status_reason}`
      )
    ).toEqual(Array(3).fill("cancelled:schedule_quarantined"))
    expect(await t.scheduleRow(single.id)).toEqual({
      status: "active",
      status_reason: null,
    })
    const legacy =
      await admin`select status from gbp_local_post_legacy_schedule where post_id = ${legacyPost}`
    expect(legacy).toEqual([{ status: "needs_review" }])
    expect(await work()).toEqual(workBefore)

    // The API shows it for review; it never runs, and the way out is a
    // revision or a cancel.
    const listed = (await (await t.api("/post-schedules")).json()) as {
      schedules: PublicationSchedule[]
    }
    expect(
      listed.schedules.find((row) => row.id === repeating.id)
    ).toMatchObject({
      status: "needs_review",
      statusReason: "recurring_quarantined",
    })
    await tick()
    expect(creates()).toHaveLength(0)
    const resumed = await t.api(`/post-schedules/${repeating.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "resume" }),
    })
    expect(resumed.status).toBe(409)
    const revised = await t.api(`/post-schedules/${repeating.id}`, {
      method: "PUT",
      body: JSON.stringify({
        rule: { frequency: "once", startDate: inDays(2), localTime: "09:00" },
        timezone: "Europe/London",
      }),
    })
    expect(revised.status, await revised.clone().text()).toBe(200)
    expect(
      scheduleResponseSchema.parse(await revised.json()).schedule
    ).toMatchObject({ status: "awaiting_approval", revision: 2 })
  })
  it("keeps a quarantined schedule in review when its in-flight occurrence settles as ambiguous", async () => {
    const t = await tenant(),
      s = await t.schedule(await t.draft(), {
        frequency: "daily",
        startDate: tomorrow(),
        localTime: "09:00",
        end: { type: "count", count: 3 },
      })
    expect((await t.approve(s)).status).toBe(200)
    const [first] = await t.occurrences(s.id)
    await t.age(first.id, 1)
    const migration = await readFile(
      new URL(
        "../../../supabase/migrations/0116_post_schedule_quarantine.sql",
        import.meta.url
      ),
      "utf8"
    )
    // 0116 lands while the first occurrence is publishing; Google then
    // fails without a readable outcome.
    state.onCreate = async () => {
      state.onCreate = null
      await runMigration(migration)
    }
    state.createStatus = 503
    state.listStatus = 503
    await tick()
    const rows = await t.occurrences(s.id)
    expect(rows.map((o) => `${o.status}:${o.status_reason}`)).toEqual([
      "ambiguous:response_ambiguous",
      "cancelled:schedule_quarantined",
      "cancelled:schedule_quarantined",
    ])
    expect(await t.scheduleRow(s.id)).toEqual({
      status: "needs_review",
      status_reason: "recurring_quarantined",
    })
    const blocked =
      await admin`select 1 from notification_incident where organisation_id = ${t.owner.organisationId} and kind = 'schedule_blocked'`
    expect(blocked).toHaveLength(0)
    state.createStatus = 200
    state.listStatus = 200
    await tick()
    expect(creates()).toHaveLength(1)
  })

  const healthTick = async () => {
    const response = await fetch(`${server.baseUrl}/api/cron/health`, {
      method: "POST",
      headers: CRON,
    })
    expect(response.status, await response.clone().text()).toBe(200)
  }
  const platformIncidents = (organisationId: string) =>
    admin<{ kind: string; status: string; occurrences: number }[]>`
      select kind, status, (details ->> 'occurrences')::int as occurrences
      from platform_incident where subject = ${organisationId}
      order by kind, status`

  it("alerts operators to a publish stuck past its lease and a slot left past its deadline, and clears once the tick moves them on (P08-R6)", async () => {
    const t = await tenant(["post_scheduling"])
    const rule = {
      frequency: "once",
      startDate: tomorrow(),
      localTime: "09:00",
    }
    const stuck = await t.schedule(await t.draft(), rule)
    expect((await t.approve(stuck)).status).toBe(200)
    const overdue = await t.schedule(await t.draft(), rule)
    expect((await t.approve(overdue)).status).toBe(200)
    const [stuckRun] = await t.occurrences(stuck.id)
    const [overdueRun] = await t.occurrences(overdue.id)
    // A claim interrupted before 0118 (no intent, no post) and never reaped:
    // still publishing 20 minutes on, its lease long gone.
    await t.age(stuckRun.id, 20)
    await admin`update post_publication_occurrence set status = 'publishing', started_at = now() - interval '20 minutes' where id = ${stuckRun.id}`
    await admin`update post_publication_schedule set claim_lease_expires_at = null where id = ${stuck.id}`
    // A slot whose window closed five minutes ago that no sweep recorded
    // (past the three-minute allowance for one slow jobs tick).
    await t.age(overdueRun.id, 10)
    try {
      await healthTick()
      expect(await platformIncidents(t.owner.organisationId)).toEqual([
        { kind: "scheduled_post_overdue", status: "open", occurrences: 1 },
        { kind: "scheduled_post_stuck", status: "open", occurrences: 1 },
      ])
      // Reporting changed nothing.
      expect((await t.occurrences(stuck.id))[0].status).toBe("publishing")
      expect((await t.occurrences(overdue.id))[0].status).toBe("scheduled")

      // The jobs tick: the sweep records the slot missed, and the claim
      // reaps the stuck publish as interrupted. The next sweep finds no
      // receipt and no post to prove it either way: the occurrence is
      // cancelled unverified and its schedule goes to review, never resent.
      await tick()
      await tick()
      expect(creates()).toHaveLength(0)
      expect((await t.occurrences(overdue.id))[0]).toMatchObject({
        status: "missed",
        status_reason: "outside_dispatch_window",
      })
      expect((await t.occurrences(stuck.id))[0]).toMatchObject({
        status: "cancelled",
        status_reason: "outcome_unverified",
      })
      expect(await t.scheduleRow(stuck.id)).toEqual({
        status: "needs_review",
        status_reason: "prior_occurrence_unverified",
      })
      const told = await admin<{ kind: string; reason: string }[]>`
        select kind, reason from notification_incident
        where organisation_id = ${t.owner.organisationId} and kind like 'schedule_%'
        order by kind, reason`
      expect(told).toEqual(
        expect.arrayContaining([
          { kind: "schedule_blocked", reason: "prior_occurrence_unverified" },
          { kind: "schedule_missed", reason: "outside_dispatch_window" },
        ])
      )

      await healthTick()
      expect(await platformIncidents(t.owner.organisationId)).toEqual([
        { kind: "scheduled_post_overdue", status: "resolved", occurrences: 1 },
        { kind: "scheduled_post_stuck", status: "resolved", occurrences: 1 },
      ])
    } finally {
      await admin`delete from platform_incident where subject = ${t.owner.organisationId}`
    }
  })

  it(
    "does not report a stuck publish while scheduled publishing is paused (P08-R6)",
    { timeout: 30_000 },
    async () => {
      const t = await tenant(["post_scheduling"])
      const s = await t.schedule(await t.draft(), {
        frequency: "once",
        startDate: tomorrow(),
        localTime: "09:00",
      })
      expect((await t.approve(s)).status).toBe(200)
      const [run] = await t.occurrences(s.id)
      await t.age(run.id, 20)
      await admin`update post_publication_occurrence set status = 'publishing', started_at = now() - interval '20 minutes' where id = ${run.id}`
      await admin`update post_publication_schedule set claim_lease_expires_at = null where id = ${s.id}`
      const pause = (paused: boolean) =>
        admin`select * from set_ops_pause('scheduled_post', ${paused}, 'post-schedules R6 test', 'post-schedules.test')`
      // The server caches the pause table for PAUSE_CACHE_TTL_MS (5 s).
      const settle = () => new Promise((resolve) => setTimeout(resolve, 5_500))
      await pause(true)
      try {
        await settle()
        await healthTick()
        expect(await platformIncidents(t.owner.organisationId)).toEqual([])
      } finally {
        await pause(false)
        await admin`update post_publication_occurrence set status = 'ambiguous', finished_at = now() where id = ${run.id}`
        await admin`delete from platform_incident where subject = ${t.owner.organisationId}`
      }
    }
  )

  it("purges ended schedule history after 180 days and keeps anything still open (P08-R6)", async () => {
    const t = await tenant(["post_scheduling"])
    const rule = {
      frequency: "once",
      startDate: tomorrow(),
      localTime: "09:00",
    }
    const act = (id: string, action: string) =>
      t.api(`/post-schedules/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      })
    // Cancelled long ago: goes, with its cancelled occurrence.
    const ended = await t.schedule(await t.draft(), rule)
    expect((await t.approve(ended)).status).toBe(200)
    expect((await act(ended.id, "cancel")).status).toBe(200)
    // Cancelled recently: kept.
    const recent = await t.schedule(await t.draft(), rule)
    expect((await act(recent.id, "cancel")).status).toBe(200)
    // In review with an unresolved occurrence, however old: kept.
    const open = await t.schedule(await t.draft(), rule)
    expect((await t.approve(open)).status).toBe(200)
    const [openRun] = await t.occurrences(open.id)
    const [endedRun] = await t.occurrences(ended.id)
    await admin`update post_publication_occurrence set finished_at = now() - interval '200 days' where id = ${endedRun.id}`
    await admin`update post_publication_schedule set updated_at = now() - interval '200 days' where id = ${ended.id}`
    await admin`update post_publication_occurrence set status = 'ambiguous', status_reason = 'response_ambiguous', finished_at = now() - interval '300 days' where id = ${openRun.id}`
    await admin`update post_publication_schedule set status = 'needs_review', status_reason = 'prior_occurrence_unverified', updated_at = now() - interval '300 days' where id = ${open.id}`

    const counts: Record<string, number> = {}
    let cursor: string | null = null
    do {
      const query = new URLSearchParams({ batch_size: "100" })
      // A hand-run page (an explicit cursor, empty for the head), so the
      // walk covers the whole fleet now instead of waiting for the cycle.
      query.set("cursor", cursor ?? "")
      const response = await fetch(
        `${server.baseUrl}/api/cron/retention?${query}`,
        { method: "POST", headers: CRON }
      )
      expect(response.status, await response.clone().text()).toBe(200)
      const page = (await response.json()) as {
        organisations: Array<Record<string, string | number>>
        nextCursor: string | null
      }
      const own = page.organisations.find(
        (entry) => entry.organisationId === t.owner.organisationId
      )
      if (own) Object.assign(counts, own)
      cursor = page.nextCursor
    } while (cursor)
    expect(counts).toMatchObject({
      scheduleOccurrences: 1,
      publicationSchedules: 1,
      legacyPostSchedules: 0,
    })
    const left = await admin<{ id: string }[]>`
      select id::text as id from post_publication_schedule
      where organisation_id = ${t.owner.organisationId} order by id`
    expect(left.map((row) => row.id).sort()).toEqual(
      [recent.id, open.id].sort()
    )
    expect(await t.occurrences(open.id)).toHaveLength(1)
    const audit = await admin`
      select metadata from audit_log
      where organisation_id = ${t.owner.organisationId} and action = 'retention.purge.completed'`
    expect(audit[0]?.metadata).toMatchObject({
      scheduleOccurrences: 1,
      publicationSchedules: 1,
    })
  })
})
