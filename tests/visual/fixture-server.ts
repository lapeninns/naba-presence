// Visual-verification fixtures. Seeds the same isolated "Sprint 5 Journey"
// tenants the Playwright suite uses, starts the Google stub they talk to,
// writes the session cookies to test-results/e2e-journey-state.json, and
// holds until SIGINT/SIGTERM, when it destroys exactly those tenants.
// It never touches the bootstrap dev organisation or real Google: launch it
// through tests/visual/with-visual-db.sh so it seeds the isolated
// `naba_visual` database, and refuses to start otherwise.
//
//   node --experimental-strip-types --import ./tests/visual/ts-resolve-hook.mjs \
//     tests/visual/fixture-server.ts
//
// Pair it with a dev server whose GOOGLE_API_PROXY_BASE points at the stub
// (APP_PORT + 1); see .claude/launch.json "visual-app".
import nextEnv from "@next/env"

nextEnv.loadEnvConfig(process.cwd(), true)

if (!process.env.DIRECT_DATABASE_URL?.endsWith("/naba_visual")) {
  throw new Error("Run through tests/visual/with-visual-db.sh (naba_visual only).")
}

const appPort = process.env.VISUAL_APP_PORT ?? "3200"
const { default: startJourneyBridge } = await import(
  "../e2e/helpers/stub-bridge"
)

const teardown = await startJourneyBridge({
  projects: [{ use: { baseURL: `http://127.0.0.1:${appPort}` } }],
} as never)
console.log(
  `[visual-fixtures] seeded; Google stub on ${process.env.GOOGLE_STUB_PORT}; state in test-results/e2e-journey-state.json`
)

// Seeded sessions expire after an hour. Keep them alive while the fixtures
// run: an expired cookie must never fall through to anything else.
const { createHash } = await import("node:crypto")
const { readFile } = await import("node:fs/promises")
const { default: postgres } = await import("postgres")
const state = JSON.parse(
  await readFile("test-results/e2e-journey-state.json", "utf8")
)
const tokenHashes = JSON.stringify(state)
  .match(/naba_session=[^"]+/g)!
  .map((cookie) =>
    createHash("sha256").update(cookie.split("=")[1]!).digest("hex")
  )
const admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
async function refreshSessions() {
  await admin`
    update app_session set expires_at = now() + interval '1 hour'
    where token_hash in ${admin(tokenHashes)}
  `
  // The stub's access tokens also expire after an hour; without this the
  // fixture listings flip to the (real) "reconnect Google" state mid-run.
  await admin`
    update google_connection
    set access_token_expires_at = now() + interval '1 hour', status = 'active',
      last_error_code = null
    where google_subject like 'stub-subject-%'
  `
  // A token that lapsed before this ran leaves a reconnect task open.
  await admin`
    update connection_task t
    set status = 'completed', resolved_at = now()
    from google_connection g
    where g.id = t.google_connection_id
      and g.google_subject like 'stub-subject-%'
      and t.status = 'open'
  `
}
await refreshSessions()
setInterval(() => void refreshSessions().catch(console.error), 10 * 60_000)

let closing = false
async function close() {
  if (closing) return
  closing = true
  await admin.end()
  await teardown()
  console.log("[visual-fixtures] tenants destroyed")
  process.exit(0)
}
process.on("SIGINT", close)
process.on("SIGTERM", close)
setInterval(() => {}, 1 << 30)
