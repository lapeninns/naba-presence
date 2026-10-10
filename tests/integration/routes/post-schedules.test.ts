import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  occurrencesResponseSchema,
  scheduleResponseSchema,
  type PublicationSchedule,
} from "@/lib/contracts/publication-schedules"
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
  }
  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    google = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      GBP_POSTS_ENABLED: "true",
      PUBLISH_ENABLED: "true",
      JOBS_ENABLED: "true",
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
    google.reset()
    google.respond({ method: "POST", pathIncludes: "/localPosts" }, (call) => {
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
    })
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

  async function tenant() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
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
    const age = (occurrenceId: string, hoursAgo: number) =>
      admin`update post_publication_occurrence set intended_at = now() - make_interval(secs => ${hoursAgo * 3600}) where id = ${occurrenceId}`
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
    await t.age(occurrence.id, 0.1)
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
    await t.age((await t.occurrences(policy.id))[0].id, 0.1)
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
    await t.age((await t.occurrences(revoked.id))[0].id, 0.1)
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

  it("publishes only the latest occurrence within 24 hours and records older ones as missed", async () => {
    const t = await tenant(),
      s = await t.schedule(await t.draft(), {
        frequency: "daily",
        startDate: tomorrow(),
        localTime: "09:00",
        end: { type: "count", count: 4 },
      })
    await t.approve(s)
    const [first, second, third] = await t.occurrences(s.id)
    await t.age(first.id, 50)
    await t.age(second.id, 30)
    await t.age(third.id, 2)
    await tick()
    const after = await t.occurrences(s.id)
    expect(after.map((o) => `${o.status}:${o.status_reason ?? ""}`)).toEqual([
      "missed:outside_grace_period",
      "missed:outside_grace_period",
      "published:",
      "scheduled:",
    ])
    expect(creates()).toHaveLength(1)
    const missed =
      await admin`select count(*)::int as count from notification_incident where organisation_id = ${t.owner.organisationId} and kind = 'schedule_missed'`
    expect(missed[0].count).toBe(2)
    await tick()
    expect(creates()).toHaveLength(1)
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
    await t.age((await t.occurrences(s.id))[0].id, 0.1)
    await tick()
    expect((await t.occurrences(s.id))[0]).toMatchObject({
      status: "missed",
      status_reason: "expired_content",
    })
    expect(creates()).toHaveLength(0)
  })

  it("keeps an ambiguous publication visible, blocks the schedule and never resubmits it", async () => {
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
    state.createStatus = 503
    state.listStatus = 503
    await tick()
    expect((await t.occurrences(s.id))[0]).toMatchObject({
      status: "ambiguous",
    })
    expect(await t.scheduleRow(s.id)).toEqual({
      status: "blocked",
      status_reason: "prior_occurrence_unresolved",
    })
    state.createStatus = 200
    state.listStatus = 200
    await t.age(second.id, 0.5)
    await tick()
    await tick()
    expect(creates()).toHaveLength(1)
    expect((await t.occurrences(s.id))[1]).toMatchObject({
      status: "scheduled",
    })
    const kinds =
      await admin`select kind from notification_incident where organisation_id = ${t.owner.organisationId} and status = 'open' order by kind`
    expect(kinds.map((row) => row.kind)).toEqual(
      expect.arrayContaining(["schedule_blocked"])
    )
  })

  it("pauses, resumes and cancels without losing or duplicating occurrences", async () => {
    const t = await tenant(),
      s = await t.schedule(await t.draft(), {
        frequency: "weekly",
        startDate: tomorrow(),
        localTime: "12:00",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        end: { type: "date", date: inDays(8) },
      })
    await t.approve(s)
    const before = await t.occurrences(s.id)
    await t.api(`/post-schedules/${s.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "pause" }),
    })
    await t.age(before[0].id, 0.2)
    await tick()
    expect(creates()).toHaveLength(0)
    await t.api(`/post-schedules/${s.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "resume" }),
    })
    await tick()
    expect(creates()).toHaveLength(1)
    const cancelled = await t.api(`/post-schedules/${s.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "cancel" }),
    })
    expect(
      scheduleResponseSchema.parse(await cancelled.json()).schedule.status
    ).toBe("cancelled")
    const after = await t.occurrences(s.id)
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
})
