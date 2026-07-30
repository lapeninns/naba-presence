import { spawn } from "node:child_process"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import nextEnv from "@next/env"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
nextEnv.loadEnvConfig(root)

const [mode, ...command] = process.argv.slice(2)
if (!mode || command.length === 0) {
  throw new Error("Usage: run-test-command.mjs <integration|e2e> <command...>")
}

if (!process.env.TEST_RUNTIME_DATABASE_URL) {
  const adminUrl = process.env.DIRECT_DATABASE_URL
  if (adminUrl) {
    const runtimeUrl = new URL(adminUrl)
    runtimeUrl.username = process.env.RUNTIME_ROLE_NAME ?? "naba_test_runtime"
    runtimeUrl.password =
      process.env.RUNTIME_ROLE_PASSWORD ?? "naba_test_runtime"
    process.env.TEST_RUNTIME_DATABASE_URL = runtimeUrl.toString()
  }
}

if (!process.env.TEST_RUNTIME_DATABASE_URL) {
  throw new Error(
    "TEST_RUNTIME_DATABASE_URL or DIRECT_DATABASE_URL is required."
  )
}

process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL
process.env.TOKEN_ENCRYPTION_KEY ??=
  "route-harness-token-key-32-characters!!"
process.env.WEBHOOKS_ENABLED = "false"
process.env.PASSWORD_AUTH_ENABLED = "false"

if (mode === "integration") {
  process.env.RUN_DB_TESTS = "true"
} else if (mode === "e2e") {
  process.env.LOCAL_BOOTSTRAP_ENABLED = "true"
} else {
  throw new Error(`Unsupported test mode: ${mode}`)
}

const child = spawn(command[0], command.slice(1), {
  cwd: root,
  env: process.env,
  stdio: "inherit",
})
child.on("exit", (code) => process.exit(code ?? 1))
