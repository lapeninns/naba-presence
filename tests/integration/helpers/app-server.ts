import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { existsSync } from "node:fs"
import { createServer } from "node:net"

const SERVER_ENTRY = ".next/standalone/server.js"

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

function serverEnv(
  port: number,
  overrides: Record<string, string>
): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH!,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    DATABASE_URL: process.env.TEST_RUNTIME_DATABASE_URL!,
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
    // The shared Google budget is exercised by rate-budget.test.ts and
    // fleet-scale.test.ts with real limits; everywhere else it would only
    // slow suites that fire bursts at a local stub.
    GOOGLE_API_REQUESTS_PER_MINUTE: "10000",
    GOOGLE_LOCATION_EDITS_PER_MINUTE: "10",
    ...overrides,
  }
}

export async function startAppServer(
  overrides: Record<string, string> = {}
) {
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
  return {
    baseUrl,
    get stdout() {
      return stdout
    },
    get stderr() {
      return stderr
    },
    stop: async () => {
      child.kill("SIGTERM")
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ])
      if (child.exitCode === null) child.kill("SIGKILL")
    },
  }
}

export async function expectBootFailure(
  overrides: Record<string, string>
) {
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
