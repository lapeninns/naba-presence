// Seeds the e2e fixture tenants, starts the Google stub and serves the
// standalone production build (`pnpm build` first) with the same environment
// as playwright.config.ts's webServer + scripts/run-test-command.mjs e2e.
// Not part of any suite; shared by nm-capture.mjs and the agentic e2e runner.
//
//   node tests/visual/nm-serve.mjs [--port <n>] [--stub-port <n>] \
//     [--log <file>] [--bootstrap] (--hold | -- <command...>)
//
// --hold   keep serving until SIGINT/SIGTERM (the e2e runner's app.command).
// -- cmd   run cmd with APP_URL and NM_STATE_FILE set, then tear down and exit
//          with its code.
//
// It refuses non-local databases (assertLocalTestDatabases): run it inside
// notion-mail-ledger/scripts/with-e2e-db.sh, which provides a throwaway PG17.
// The seeded session cookies land in test-results/e2e-journey-state.json.
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, openSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createServer } from "node:net"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import nextEnv from "@next/env"

import "./ts-resolve-hook.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
process.chdir(root)

const argv = process.argv.slice(2)
const split = argv.indexOf("--")
const own = split === -1 ? argv : argv.slice(0, split)
const command = split === -1 ? [] : argv.slice(split + 1)
const arg = (name) => {
  const index = own.indexOf(`--${name}`)
  return index === -1 ? undefined : own[index + 1]
}
const hold = own.includes("--hold")
if (!hold && command.length === 0) {
  console.error("usage: nm-serve.mjs [--port n] (--hold | -- <command...>)")
  process.exit(2)
}

const log = (message) => console.error(`[nm-serve] ${message}`)

function freePort() {
  return new Promise((done, fail) => {
    const server = createServer()
    server.unref()
    server.on("error", fail)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      server.close(() => done(port))
    })
  })
}

// Same env resolution as scripts/run-test-command.mjs e2e.
nextEnv.loadEnvConfig(root)
const { assertLocalTestDatabases } =
  await import("../../scripts/run-test-command.mjs")
if (!process.env.TEST_RUNTIME_DATABASE_URL && process.env.DIRECT_DATABASE_URL) {
  const runtime = new URL(process.env.DIRECT_DATABASE_URL)
  runtime.username = process.env.RUNTIME_ROLE_NAME ?? "naba_test_runtime"
  runtime.password = process.env.RUNTIME_ROLE_PASSWORD ?? "naba_test_runtime"
  process.env.TEST_RUNTIME_DATABASE_URL = runtime.toString()
}
if (
  !process.env.DIRECT_DATABASE_URL ||
  !process.env.TEST_RUNTIME_DATABASE_URL
) {
  log("DIRECT_DATABASE_URL is required (run inside with-e2e-db.sh)")
  process.exit(2)
}
assertLocalTestDatabases(process.env)

const server = resolve(root, ".next/standalone/server.js")
if (!existsSync(server)) {
  log(`${server} is missing: run pnpm build first`)
  process.exit(2)
}

const port = Number(
  arg("port") ??
    (command.length ? process.env.PLAYWRIGHT_PORT : undefined) ??
    (await freePort())
)
const stubPort = Number(
  arg("stub-port") ??
    process.env.PLAYWRIGHT_GOOGLE_STUB_PORT ??
    (await freePort())
)
process.env.PLAYWRIGHT_GOOGLE_STUB_PORT = String(stubPort)
const baseURL = `http://127.0.0.1:${port}`
const tokenEncryptionKey =
  process.env.TOKEN_ENCRYPTION_KEY ?? "route-harness-token-key-32-characters!!"

const started = Date.now()
const { default: startJourneyBridge, journeyStatePath } =
  await import("../e2e/helpers/stub-bridge.ts")
const teardown = await startJourneyBridge({
  projects: [{ use: { baseURL } }],
})
log(`seeded; Google stub on ${stubPort}; state ${journeyStatePath}`)

// Seeded sessions and stub tokens expire after an hour (as fixture-server.ts).
const { default: postgres } = await import("postgres")
const state = JSON.parse(await readFile(journeyStatePath, "utf8"))
const tokenHashes = JSON.stringify(state)
  .match(/naba_session=[^"]+/g)
  .map((cookie) =>
    createHash("sha256").update(cookie.split("=")[1]).digest("hex")
  )
const admin = postgres(process.env.DIRECT_DATABASE_URL, { max: 1 })
async function refreshSessions() {
  await admin`
    update app_session set expires_at = now() + interval '1 hour'
    where token_hash in ${admin(tokenHashes)}
  `
  await admin`
    update google_connection
    set access_token_expires_at = now() + interval '1 hour', status = 'active',
      last_error_code = null
    where google_subject like 'stub-subject-%'
  `
}
const refresher = setInterval(
  () => void refreshSessions().catch((error) => log(String(error))),
  10 * 60_000
)

const logFile = resolve(arg("log") ?? "test-results/nm-serve-app.log")
mkdirSync(dirname(logFile), { recursive: true })
const out = openSync(logFile, "a")
const app = spawn(process.execPath, [server], {
  cwd: root,
  stdio: ["ignore", out, out],
  env: {
    ...process.env,
    DATABASE_URL: process.env.TEST_RUNTIME_DATABASE_URL,
    // scripts/run-test-command.mjs e2e sets this true, which signs every
    // request without a session in as the local owner, so anonymous pages
    // (/sign-in, /privacy) redirect to /inbox. Off by default here, as the
    // repo's "visual-app" launch config does; --bootstrap restores it.
    LOCAL_BOOTSTRAP_ENABLED: own.includes("--bootstrap") ? "true" : "false",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    // playwright.config.ts webServer.env, verbatim.
    GOOGLE_API_PROXY_BASE: `http://127.0.0.1:${stubPort}`,
    NEXTAUTH_URL: baseURL,
    OPENAI_API_KEY: "",
    TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
    WEBHOOKS_ENABLED: "false",
    PASSWORD_AUTH_ENABLED: "false",
    GBP_PROFILE_WRITES_ENABLED: "true",
    GBP_MEDIA_ENABLED: "true",
    GBP_POSTS_ENABLED: "true",
    GBP_FOOD_MENUS_ENABLED: "true",
    GBP_PLACE_ACTIONS_ENABLED: "true",
    GBP_PERFORMANCE_ENABLED: "true",
    GBP_KEYWORDS_ENABLED: "true",
    ABUSE_LIMITS_ENABLED: "false",
    DESIGN_SYSTEM_EVIDENCE_ENABLED: "true",
    REGISTRATION_WORKSPACE_CHOICE_ENABLED: "true",
    BILLING_ENABLED: "true",
  },
})

let closing = false
async function close(code) {
  if (closing) return
  closing = true
  clearInterval(refresher)
  if (app.exitCode === null) {
    app.kill("SIGTERM")
    await new Promise((done) => {
      const timer = setTimeout(() => (app.kill("SIGKILL"), done()), 5_000)
      app.once("exit", () => (clearTimeout(timer), done()))
    })
  }
  await admin.end().catch(() => {})
  await teardown().catch((error) => log(`teardown: ${error}`))
  log(`stopped after ${Math.round((Date.now() - started) / 1000)}s`)
  process.exit(code)
}
process.on("SIGINT", () => void close(130))
process.on("SIGTERM", () => void close(143))
app.once("exit", (code) => {
  if (!closing) {
    log(`app exited early (code ${code}); see ${logFile}`)
    void close(3)
  }
})

// Ready = any non-5xx answer, as Playwright's webServer waits.
const deadline = Date.now() + 90_000
for (;;) {
  try {
    const response = await fetch(baseURL, { redirect: "manual" })
    if (response.status < 500) break
  } catch {}
  if (Date.now() > deadline) {
    log(`app not ready on ${baseURL} after 90s; see ${logFile}`)
    await close(3)
  }
  await new Promise((done) => setTimeout(done, 500))
}
log(`app ready on ${baseURL} in ${Math.round((Date.now() - started) / 1000)}s`)

if (hold) {
  setInterval(() => {}, 1 << 30)
} else {
  const child = spawn(command[0], command.slice(1), {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      APP_URL: baseURL,
      NM_STATE_FILE: journeyStatePath,
      GOOGLE_STUB_PORT: String(stubPort),
    },
  })
  child.on("exit", (code, signal) => void close(code ?? (signal ? 1 : 0)))
}
