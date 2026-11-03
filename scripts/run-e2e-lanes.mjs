// After `pnpm build`, run this under the shared `with-lock.sh e2e` lock.
// Set NABA_E2E_DB_WRAPPER to the ledger's with-e2e-db.sh on the Factory host.
// Each lane retains one Playwright worker and gets its own disposable fixtures.
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync } from "node:fs"
import { cp, mkdir, open, rm } from "node:fs/promises"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"

import { childEnv, parseExports } from "./release/verify-local.mjs"
import { SIGNAL_EXIT_CODES } from "./run-test-command.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const count = process.env.NABA_E2E_LANES ?? "4"
const dbWrapper = process.env.NABA_E2E_DB_WRAPPER
const args = process.argv.slice(2)
const standalone = join(root, ".next", "standalone")
const env = { ...childEnv(process.env), CI: "1", NABA_TEST_DB: "throwaway" }

if (!/^[1-4]$/.test(count)) throw new Error("NABA_E2E_LANES must be 1–4.")
if (
  args.some((arg) =>
    /^(--(?:config|output|reporter|shard|workers|fully-parallel|pass-with-no-tests|ui|debug|last-failed|list)|-c|-j)(?:=|$)/.test(
      arg
    )
  )
) {
  throw new Error(
    "Pass test files, projects or filters. The runner owns sharding and isolation options."
  )
}
if (!existsSync(join(standalone, "server.js")))
  throw new Error("Run pnpm build first.")
for (const dir of [root, standalone]) {
  if (
    readdirSync(dir).some(
      (name) => /^\.env(?:\.|$)/.test(name) && name !== ".env.example"
    )
  ) {
    throw new Error(
      "Use a private fixture checkout and build without dotenv files."
    )
  }
}

const output = mkdtempSync(join(root, "test-results-lanes-"))
const usedPorts = new Set()
const children = new Set()
let interrupted

for (const signal of Object.keys(SIGNAL_EXIT_CODES)) {
  process.on(signal, () => {
    interrupted ??= signal
    for (const child of children) {
      if (!child.pid) continue
      try {
        process.kill(-child.pid, signal)
      } catch (error) {
        if (error.code !== "ESRCH") console.error(error)
      }
    }
  })
}

function portPair() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const stdout = execFileSync(
      process.execPath,
      ["scripts/ci/postgres.mjs", "ports"],
      { cwd: root, env, encoding: "utf8" }
    )
    const port = Number(parseExports(stdout).PLAYWRIGHT_PORT)
    if (port && !usedPorts.has(port) && !usedPorts.has(port + 1)) {
      usedPorts.add(port)
      usedPorts.add(port + 1)
      return port
    }
  }
  throw new Error(
    "Could not allocate distinct app and stub ports for the lanes."
  )
}

async function runLane(index, port) {
  const name = `lane-${index}`
  const dir = join(output, name)
  const appDir = join(dir, "app")
  const state = join(dir, "journey-state.json")
  await mkdir(dir)
  const log = await open(join(dir, "playwright.log"), "w", 0o600)
  try {
    // Servers can write to their Next build tree (e.g. the image cache).
    await cp(standalone, appDir, { recursive: true, verbatimSymlinks: true })
    if (interrupted) return SIGNAL_EXIT_CODES[interrupted]
    console.log(`[${name}] app ${port}, Google stub ${port + 1}, ${dir}`)
    const child = spawn(
      dbWrapper || process.execPath,
      [
        ...(dbWrapper ? [process.execPath] : []),
        "scripts/run-test-command.mjs",
        "e2e",
        "pnpm",
        "exec",
        "playwright",
        "test",
        ...args,
        `--shard=${index}/${count}`,
        "--reporter=list,json",
      ],
      {
        cwd: root,
        env: {
          ...env,
          PLAYWRIGHT_PORT: String(port),
          PLAYWRIGHT_APP_DIR: appDir,
          PLAYWRIGHT_OUTPUT_DIR: join(dir, "results"),
          PLAYWRIGHT_JSON_OUTPUT_FILE: join(dir, "report.json"),
          E2E_JOURNEY_STATE_PATH: state,
          SHARD: `${basename(output)}-${name}`,
        },
        stdio: ["ignore", log.fd, log.fd],
        detached: true,
      }
    )
    children.add(child)
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("close", (status, signal) =>
        resolve(status ?? SIGNAL_EXIT_CODES[signal] ?? 1)
      )
    }).finally(() => children.delete(child))
    console.log(`[${name}] ${code === 0 ? "passed" : `failed (${code})`}`)
    return code
  } finally {
    await log.close()
    await rm(state, { force: true })
    await rm(appDir, { recursive: true, force: true })
  }
}

const ports = Array.from({ length: Number(count) }, portPair)
const results = await Promise.allSettled(
  ports.map((port, i) => runLane(i + 1, port))
)
for (const result of results)
  if (result.status === "rejected") console.error(result.reason)
console.log(`Lane logs and reports: ${output}`)
process.exitCode = interrupted
  ? SIGNAL_EXIT_CODES[interrupted]
  : Number(results.some((r) => r.status === "rejected" || r.value !== 0))
