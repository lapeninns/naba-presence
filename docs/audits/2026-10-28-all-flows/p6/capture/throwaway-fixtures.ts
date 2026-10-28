// The p6 capture's fixture server: tests/visual/fixture-server.ts, but for a
// throwaway PostgreSQL cluster started by scripts/run-test-command.mjs
// instead of the local `naba_visual` database (which was not available on
// 28 Oct 2026). Seeds the same "Sprint 5 Journey" tenants through the e2e
// stub bridge of the checkout under test (the current directory), starts
// the Google stub, writes test-results/e2e-journey-state.json, and holds
// until SIGINT/SIGTERM, when it destroys those tenants.
//
//   node scripts/run-test-command.mjs e2e sh <this dir>/run-throwaway.sh
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import nextEnv from "@next/env"

nextEnv.loadEnvConfig(process.cwd(), true)

// Only ever against a cluster scripts/ci/postgres.mjs started for this run.
if (!process.env.NABA_PG_DISPOSABLE) {
  throw new Error(
    "Run through scripts/run-test-command.mjs (throwaway cluster only)."
  )
}

const appPort = process.env.VISUAL_APP_PORT ?? "3562"
const bridge = pathToFileURL(
  resolve(process.cwd(), "tests/e2e/helpers/stub-bridge.ts")
).href
const { default: startJourneyBridge } = await import(bridge)

const teardown = await startJourneyBridge({
  projects: [{ use: { baseURL: `http://127.0.0.1:${appPort}` } }],
} as never)
console.log(
  `[p6-fixtures] seeded; Google stub on ${process.env.GOOGLE_STUB_PORT}; state in test-results/e2e-journey-state.json`
)

let closing = false
async function close() {
  if (closing) return
  closing = true
  await teardown()
  console.log("[p6-fixtures] tenants destroyed")
  process.exit(0)
}
process.on("SIGINT", close)
process.on("SIGTERM", close)
setInterval(() => {}, 1 << 30)
