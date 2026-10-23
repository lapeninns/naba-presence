import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { existsSync } from "node:fs"
import { createServer } from "node:net"

const SERVER_ENTRY = ".next/standalone/server.js"

/**
 * How long stop() lets the server drain. On SIGTERM Next stops accepting
 * connections and finishes the requests in flight, so a tick still running
 * ends its fleet lease (lib/server/leases.ts) instead of leaving the row to
 * block that key for FLEET_LEASE_SECONDS. Under Vitest's default 10 s hook
 * timeout, so a stuck server fails over to SIGKILL rather than the hook.
 */
const STOP_GRACE_MS = 8_000

/**
 * Boot overrides for suites that flip operator pauses: the app reads the
 * pause table on every check instead of caching it for 5 s
 * (lib/server/pause-controls.ts pauseCacheTtlMs), so a pause or an unpause
 * applies to the next request and nothing sleeps out the cache.
 */
export const UNCACHED_PAUSES = { PAUSE_CACHE_TTL_MS: "0" } as const

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolve(port))
    })
  })
}

/** Exported for tests/server/run-test-command-guard.test.ts. */
export function serverEnv(
  port: number,
  overrides: Record<string, string>
): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH!,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    DATABASE_URL: process.env.TEST_RUNTIME_DATABASE_URL!,
    // Set here so the server never takes it from a .env file copied into
    // .next/standalone, which Next loads for any variable left unset: the
    // lease and session-pool connections (lib/server/db.ts) would reach
    // whatever database that file names.
    DATABASE_SESSION_URL:
      process.env.DATABASE_SESSION_URL ??
      process.env.TEST_RUNTIME_DATABASE_URL!,
    NEXTAUTH_URL: `http://127.0.0.1:${port}`,
    NEXTAUTH_SECRET: "route-harness-secret-value-32-characters!",
    TOKEN_ENCRYPTION_KEY:
      process.env.TOKEN_ENCRYPTION_KEY ??
      "route-harness-token-key-32-characters!!",
    CRON_SECRET: "route-harness-cron-secret",
    LOCAL_BOOTSTRAP_ENABLED: "false",
    WEBHOOKS_ENABLED: "false",
    PASSWORD_AUTH_ENABLED: "false",
    OPENAI_API_KEY: "",
    // The shared Google budget lives in the database every suite shares, so
    // one suite's stubbed 429 would block the next suite's calls for the
    // Retry-After. It is switched on, with real limits, only by the suites
    // that test it (rate-budget, fleet-scale).
    GOOGLE_RATE_BUDGET_ENABLED: "false",
    // Abuse-limit counters are shared the same way, and suites sign in and
    // draft far faster than any person. Only abuse-limits.test.ts turns them
    // on.
    ABUSE_LIMITS_ENABLED: "false",
    // Suites never reach the real Pwned Passwords API; the check is covered
    // with a mocked API by tests/server/breached-password*.test.ts.
    BREACHED_PASSWORD_CHECK_ENABLED: "false",
    ...overrides,
  }
}

export async function startAppServer(overrides: Record<string, string> = {}) {
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error("Standalone build missing - run `pnpm build` first")
  }
  if (!process.env.TEST_RUNTIME_DATABASE_URL) {
    throw new Error("TEST_RUNTIME_DATABASE_URL is required")
  }
  const port = await freePort()
  const child: ChildProcess = spawn("node", [SERVER_ENTRY], {
    env: serverEnv(port, overrides),
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  child.stdout?.on("data", (chunk) => (stdout += chunk))
  child.stderr?.on("data", (chunk) => (stderr += chunk))
  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 30_000
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited ${child.exitCode}: ${stderr}`)
    }
    if (stderr.includes("Failed to prepare server")) {
      child.kill("SIGKILL")
      throw new Error(`Server failed to prepare: ${stderr}`)
    }
    try {
      const response = await fetch(`${baseUrl}/api/session`)
      if (response.status < 500) break
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL")
      throw new Error(`Server never became ready: ${stderr}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  // A server that dies mid-suite otherwise shows up only as ECONNREFUSED in
  // whichever test calls it next; say why it died.
  let stopping = false
  child.once("exit", (code, signal) => {
    if (stopping) return
    console.error(
      `[app-server] ${baseUrl} exited unexpectedly (code ${code}, signal ${signal})\n${stderr.slice(-4000)}`
    )
  })
  return {
    baseUrl,
    get stdout() {
      return stdout
    },
    get stderr() {
      return stderr
    },
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return
      stopping = true
      const exited = once(child, "exit")
      child.kill("SIGTERM")
      let timer: NodeJS.Timeout | undefined
      const drained = await Promise.race([
        exited.then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), STOP_GRACE_MS)
        }),
      ])
      clearTimeout(timer)
      if (!drained) {
        console.error(
          `[app-server] ${baseUrl} did not drain within ${STOP_GRACE_MS} ms; killing it (a tick it was running keeps its lease until it expires)`
        )
        child.kill("SIGKILL")
        await exited
      }
    },
  }
}

export async function expectBootFailure(overrides: Record<string, string>) {
  try {
    const server = await startAppServer(overrides)
    await server.stop()
    throw new Error("Server booted but was expected to fail")
  } catch (error) {
    const message = String(error)
    if (message.includes("expected to fail")) throw error
    return message
  }
}
