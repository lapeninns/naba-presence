import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  readinessResponseSchema,
  type ReadinessResponse,
} from "@/lib/contracts/operations"

import { startAppServer } from "../helpers/app-server"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip
const RELEASE_SHA = "0123456789abcdef0123456789abcdef01234567"
const CRON = { authorization: "Bearer route-harness-cron-secret" }

type HeartbeatRow = {
  name: string
  beatAt: Date | null
  consecutiveSkips: number
  lastCycleCompletedAt: Date | null
}

describeDatabase("operations readiness", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  let saved: HeartbeatRow[] = []

  async function readiness(baseUrl = server.baseUrl) {
    const response = await fetch(`${baseUrl}/api/operations/readiness`, {
      headers: CRON,
    })
    const body = (await response.json()) as ReadinessResponse
    return { status: response.status, body, headers: response.headers }
  }

  const reasonCodes = (body: ReadinessResponse) =>
    body.reasons.map((reason) =>
      reason.subject ? `${reason.code}:${reason.subject}` : reason.code
    )

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    // ops_heartbeat is platform-wide: keep what other suites left and put it
    // back afterwards.
    saved = await admin<HeartbeatRow[]>`
      select
        name,
        beat_at as "beatAt",
        consecutive_skips as "consecutiveSkips",
        last_cycle_completed_at as "lastCycleCompletedAt"
      from ops_heartbeat
    `
    server = await startAppServer({ NABA_RELEASE_SHA: RELEASE_SHA })
  }, 60_000)

  beforeEach(async () => {
    // Every tick (and the scheduler stamp) freshly completed. On a fresh
    // database no jobs tick has written the scheduler stamp yet.
    await admin`
      insert into ops_heartbeat (name, beat_at) values ('scheduler', now())
      on conflict (name) do nothing
    `
    await admin`
      update ops_heartbeat
      set beat_at = now(),
        consecutive_skips = 0,
        last_cycle_completed_at = case
          when name = 'retention' then now() else last_cycle_completed_at
        end
    `
  })

  afterAll(async () => {
    await server?.stop()
    if (!saved.some((row) => row.name === "scheduler")) {
      await admin`delete from ops_heartbeat where name = 'scheduler'`
    }
    for (const row of saved) {
      await admin`
        update ops_heartbeat
        set beat_at = ${row.beatAt},
          consecutive_skips = ${row.consecutiveSkips},
          last_cycle_completed_at = ${row.lastCycleCompletedAt}
        where name = ${row.name}
      `
    }
    await admin?.end()
  })

  it("refuses a request without the cron bearer token", async () => {
    const missing = await fetch(`${server.baseUrl}/api/operations/readiness`)
    expect(missing.status).toBe(401)
    const wrong = await fetch(`${server.baseUrl}/api/operations/readiness`, {
      headers: { authorization: "Bearer wrong-token" },
    })
    expect(wrong.status).toBe(401)
  })

  it("reports a live fleet with its release, schema and configuration gaps", async () => {
    const { status, body, headers } = await readiness()
    expect(headers.get("cache-control")).toBe("no-store")
    // The whole answer is the contract, and nothing else: no tenant data.
    expect(() => readinessResponseSchema.strict().parse(body)).not.toThrow()
    expect(body.release).toEqual({
      sha: RELEASE_SHA,
      source: "naba_release_sha",
    })
    expect(body.schema).toMatchObject({ compatible: true, missing: [] })
    expect(body.database).toEqual({ reachable: true })
    expect(body.scheduler?.stale).toBe(false)
    expect(body.ticks.map((tick) => tick.name)).toContain("health")
    expect(body.ticks.every((tick) => tick.state === "ok")).toBe(true)
    // The harness runs with no email provider, no operator recipients and no
    // collector: degraded, and saying so.
    expect(reasonCodes(body)).toEqual(
      expect.arrayContaining([
        "email_not_configured",
        "ops_recipients_missing",
        "telemetry_disabled:no_endpoint",
      ])
    )
    expect(body.telemetry).toMatchObject({
      state: "disabled",
      reason: "no_endpoint",
    })
    // Another suite may have left an incident whose alert went nowhere (the
    // harness has no email provider); that is the only thing allowed to make
    // this fleet not ready.
    const blocking = body.reasons.filter(
      (reason) =>
        reason.severity === "not_ready" && reason.code !== "alert_undelivered"
    )
    expect(blocking).toEqual([])
    expect(status).toBe(body.ok ? 200 : 503)
  })

  it("answers 503 when the health tick has stopped", async () => {
    await admin`
      update ops_heartbeat set beat_at = now() - interval '1 day'
      where name = 'health'
    `
    const { status, body } = await readiness()
    expect(status).toBe(503)
    expect(body.status).toBe("not_ready")
    expect(body.ok).toBe(false)
    expect(reasonCodes(body)).toContain("tick_stale:health")
    expect(body.ticks.find((tick) => tick.name === "health")?.state).toBe(
      "stale"
    )
  })

  it("answers 503 for an open incident no operator was told about", async () => {
    const [incident] = await admin<{ id: string }[]>`
      insert into platform_incident (kind, subject, notify_status, notify_error)
      values ('tick_lock_wedged', 'readiness-fixture', 'suppressed', 'no_ops_recipients')
      returning id::text as id
    `
    try {
      const { status, body } = await readiness()
      expect(status).toBe(503)
      expect(reasonCodes(body)).toContain("alert_undelivered")
      expect(body.incidents?.undelivered).toBeGreaterThanOrEqual(1)
    } finally {
      await admin`delete from platform_incident where id = ${incident.id}`
    }
  })

  it("reads a paused notifications scope as alerting paused, not a dead tick", async () => {
    const paused = await startAppServer({
      NABA_RELEASE_SHA: RELEASE_SHA,
      NOTIFICATIONS_ENABLED: "false",
    })
    try {
      await admin`
        update ops_heartbeat set beat_at = now() - interval '1 day'
        where name = 'health'
      `
      const { body } = await readiness(paused.baseUrl)
      const codes = reasonCodes(body)
      expect(codes).toEqual(
        expect.arrayContaining([
          "pause_active:notifications",
          "alerting_paused",
        ])
      )
      expect(codes).not.toContain("tick_stale:health")
      expect(body.pause.scopes).toContain("notifications")
      expect(body.ticks.find((tick) => tick.name === "health")?.state).toBe(
        "paused"
      )
    } finally {
      await paused.stop()
    }
  }, 60_000)
})
