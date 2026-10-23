import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

/**
 * W0-02: the self-hosted scheduler runs the same execution model as Vercel
 * Cron. Its reconcile tick used to POST `/api/sync/reconcile` with the cron
 * bearer, which walked every organisation and synced each location inline
 * behind a cursor kept in the scheduler's memory. It now fires the
 * vercel.json GET, which only queues reconcile checkpoints for the job
 * runner. The real `scripts/scheduler.mjs` is spawned against the app and
 * stopped after its first reconcile tick, which it fires at once instead of
 * 5 s in (SCHEDULER_INITIAL_DELAY_MS_RECONCILIATION); the jobs tick, which
 * would drain the queue, keeps its 10 s first delay.
 */
describeDatabase("self-hosted scheduler parity", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    stub = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      GOOGLE_TIMEOUT_MS: "3000",
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await admin.end()
  })

  /** Runs the scheduler until it logs `<event>`; returns that record. */
  async function schedulerUntil(
    event: string
  ): Promise<Record<string, unknown>> {
    const child: ChildProcess = spawn("node", ["scripts/scheduler.mjs"], {
      env: {
        ...process.env,
        CRON_SECRET: "route-harness-cron-secret",
        SCHEDULER_BASE_URL: server.baseUrl,
        SCHEDULER_INITIAL_DELAY_MS_RECONCILIATION: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout?.on("data", (chunk) => (output += chunk))
    child.stderr?.on("data", (chunk) => (output += chunk))
    try {
      const deadline = Date.now() + 20_000
      for (;;) {
        const record = output
          .split("\n")
          .filter((line) => line.startsWith("{"))
          .map((line) => JSON.parse(line) as Record<string, unknown>)
          .find((line) => line.event === event)
        if (record) return record
        if (child.exitCode !== null || Date.now() > deadline) {
          throw new Error(`scheduler never logged ${event}:\n${output}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    } finally {
      if (child.exitCode === null) {
        child.kill("SIGTERM")
        await once(child, "exit")
      }
    }
  }

  it("queues reconcile through the cron GET instead of syncing inline", async () => {
    const startedAt = new Date()
    const callsBefore = stub.calls.length
    const record = await schedulerUntil("reconciliation.completed")
    expect(record).toMatchObject({
      organisations: expect.any(Number),
      queued: expect.any(Number),
    })
    // The enqueue reads nothing from Google...
    expect(stub.calls.slice(callsBefore)).toEqual([])
    // ...and starts no inline reconcile: the cron POST walk audited
    // `sync.reconcile.started` for every organisation it reached.
    const [started] = await admin<{ count: number }[]>`
      select count(*)::integer as count
      from audit_log
      where action = 'sync.reconcile.started'
        and created_at >= ${startedAt}
    `
    expect(started.count).toBe(0)
    // What it did instead: every location ensure_recurring_checkpoints
    // (0048) arms has a reconcile checkpoint for the job runner to claim.
    const [unqueued] = await admin<{ count: number }[]>`
      select count(*)::integer as count
      from location_link ll
      join external_location e on e.id = ll.external_location_id
      join google_connection gc on gc.id = e.google_connection_id
      where ll.is_active
        and gc.status in ('active', 'expired')
        and not exists (
          select 1 from sync_checkpoint c
          where c.external_location_id = e.id
            and c.sync_type = 'reconcile'
        )
    `
    expect(unqueued.count).toBe(0)
  }, 30_000)
})
