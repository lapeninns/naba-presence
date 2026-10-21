import { spawn } from "node:child_process"
import { once } from "node:events"

import { describe, expect, it } from "vitest"

const DEFAULT_INITIAL_DELAYS_MS = {
  reconciliation: 5_000,
  retention: 30_000,
  jobs: 10_000,
  health: 50_000,
  performance: 20_000,
  keywords: 25_000,
  presence_resources: 35_000,
  sweep: 45_000,
  billing_reconcile: 55_000,
}

/** Starts scripts/scheduler.mjs and returns its `scheduler.started` record. */
async function startedRecord(env: Record<string, string>) {
  const child = spawn(process.execPath, ["scripts/scheduler.mjs"], {
    env: {
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      CRON_SECRET: "scheduler-test-cron-secret",
      // Nothing listens here; the test stops it before any tick fires.
      SCHEDULER_BASE_URL: "http://127.0.0.1:9",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let output = ""
  child.stdout.on("data", (chunk) => (output += chunk))
  try {
    const deadline = Date.now() + 10_000
    for (;;) {
      const record = output
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((line) => line.event === "scheduler.started")
      if (record) return record
      if (child.exitCode !== null || Date.now() > deadline) {
        throw new Error(`scheduler never started:\n${output}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM")
      await once(child, "exit")
    }
  }
}

// NP1-013: the parity suite fires reconciliation at once instead of waiting
// out its 5 s first delay. The knob may only bring a first fire forward.
describe("scheduler initial delays", () => {
  it("keeps every default first delay when nothing is set", async () => {
    const record = await startedRecord({})
    expect(record.initialDelaysMs).toEqual(DEFAULT_INITIAL_DELAYS_MS)
  })

  it("brings one tick forward and never pushes one back", async () => {
    const record = await startedRecord({
      SCHEDULER_INITIAL_DELAY_MS_RECONCILIATION: "0",
      SCHEDULER_INITIAL_DELAY_MS_JOBS: "600000",
      SCHEDULER_INITIAL_DELAY_MS_SWEEP: "-5",
      SCHEDULER_INITIAL_DELAY_MS_HEALTH: "soon",
    })
    expect(record.initialDelaysMs).toEqual({
      ...DEFAULT_INITIAL_DELAYS_MS,
      reconciliation: 0,
    })
  })
})
