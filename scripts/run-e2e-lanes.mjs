// After `pnpm build`, run this under the shared `with-lock.sh e2e` lock.
// The Factory ledger is detected on this Mac; set NABA_E2E_DB_WRAPPER to use
// a ledger at a different location.
// Each lane retains one Playwright worker and gets its own disposable fixtures.
import { execFileSync, spawn } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from "node:fs"
import { cp, mkdir, open, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"

import { childEnv, parseExports } from "./release/verify-local.mjs"
import { SIGNAL_EXIT_CODES } from "./run-test-command.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const count = process.env.NABA_E2E_LANES ?? "4"
const args = process.argv.slice(2)
const standalone = join(root, ".next", "standalone")
const env = { ...childEnv(process.env), CI: "1", NABA_TEST_DB: "throwaway" }

function factoryDbWrapper() {
  const installed = join(
    homedir(),
    "LapenInns Project",
    "platform",
    "naba-presence-redesign",
    "notion-mail-ledger"
  )
  const configured = process.env.NABA_E2E_DB_WRAPPER
  const ledger = existsSync(installed)
    ? installed
    : configured && dirname(dirname(realpathSync(configured)))
  if (!ledger) return

  const withLock = join(ledger, "scripts", "with-lock.sh")
  const wrapper = realpathSync(join(ledger, "scripts", "with-e2e-db.sh"))
  if (
    !existsSync(withLock) ||
    (configured && realpathSync(configured) !== wrapper)
  ) {
    throw new Error(
      "Use the Factory ledger's paired lock and database wrappers."
    )
  }

  // A lock held by an unrelated live process does not cover this run.
  const pidFile = join(ledger, "locks", "e2e.lock", "pid")
  if (existsSync(pidFile)) {
    const holder = Number(readFileSync(pidFile, "utf8").trim())
    for (let pid = process.ppid; pid > 1;) {
      if (pid === holder) return wrapper
      const parent = Number(
        execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], {
          encoding: "utf8",
        }).trim()
      )
      if (!Number.isInteger(parent) || parent === pid) break
      pid = parent
    }
  }
  throw new Error(`Run this command under the Factory e2e lock at ${withLock}.`)
}

const dbWrapper = factoryDbWrapper()

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
        // Playwright handles SIGINT and closes its separately spawned server.
        // Keep the caller's original signal for this runner's exit status.
        process.kill(-child.pid, "SIGINT")
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

function ownsAppPid(pid, appDir) {
  try {
    if (process.platform === "linux")
      return readlinkSync(`/proc/${pid}/cwd`) === appDir
    const cwd = execFileSync(
      "lsof",
      ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
      {
        encoding: "utf8",
      }
    )
    return cwd.split("\n").includes(`n${appDir}`)
  } catch (error) {
    if (error.code === "ENOENT" && process.platform === "linux") return false
    if (error.status === 1 && !error.stderr?.length) return false
    throw error
  }
}

async function stopLaneApp(appDir) {
  const pidFile = join(appDir, "lane-app.pid")
  if (!existsSync(pidFile)) return
  const pid = Number(readFileSync(pidFile, "utf8").trim())
  if (!Number.isInteger(pid) || pid < 2)
    throw new Error(`Invalid app PID in ${pidFile}`)

  // Playwright's webServer has a detached process group. On cancellation it
  // can outlive the test command, so check the PID's private cwd before acting.
  const cwd = realpathSync(appDir)
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    if (!ownsAppPid(pid, cwd)) return
    try {
      process.kill(pid, signal)
    } catch (error) {
      if (error.code === "ESRCH") return
      throw error
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      await delay(100)
      if (!ownsAppPid(pid, cwd)) return
    }
  }
  throw new Error(
    `Lane app ${pid} did not stop. Preserved its build at ${cwd}.`
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
    await writeFile(
      join(appDir, "lane-pid.cjs"),
      'require("node:fs").writeFileSync("lane-app.pid", String(process.pid), { mode: 0o600 })\n',
      { flag: "wx", mode: 0o600 }
    )
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
    await stopLaneApp(appDir)
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
