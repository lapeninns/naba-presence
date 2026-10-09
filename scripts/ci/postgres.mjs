#!/usr/bin/env node
// Throwaway PostgreSQL 17 for CI jobs and local reproduction. No dependencies.
//
//   node scripts/ci/postgres.mjs start   start a fresh cluster on a free port
//   node scripts/ci/postgres.mjs stop    stop it and delete its data (idempotent)
//   node scripts/ci/postgres.mjs ports   pick a free PLAYWRIGHT_PORT
//
// Modes (NABA_PG_MODE): `docker` (default on Linux) runs postgres:17-alpine;
// `native` (default on macOS) runs initdb/pg_ctl from Homebrew postgresql@17
// (override the bin dir with NABA_PG_BIN). Each instance is a separate
// cluster, so advisory locks and cluster-wide roles never collide.
//
// Variables are appended to $GITHUB_ENV when it is set; otherwise they are
// printed as `export` lines, e.g. `eval "$(node scripts/ci/postgres.mjs start)"`.
// State lives in NABA_PG_DIR (default: $RUNNER_TEMP or the OS temp dir, plus
// a per-job name), which is where pg.log is written on the native path.

import { execFileSync, spawnSync } from "node:child_process"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

const DATABASE = "nabareview_test"
const SUPERUSER = "postgres"
const PASSWORD = "postgres"
const RUNTIME_ROLE = "naba_test_runtime"
const IMAGE = "postgres:17-alpine"

const instance = [
  "naba-pg",
  process.env.GITHUB_RUN_ID ?? "local",
  process.env.GITHUB_JOB,
  process.env.SHARD,
]
  .filter(Boolean)
  .join("-")
  .replace(/[^a-zA-Z0-9_.-]/g, "-")
const stateDir =
  process.env.NABA_PG_DIR ?? join(process.env.RUNNER_TEMP ?? tmpdir(), instance)
const stateFile = join(stateDir, "state.json")
const logFile = join(stateDir, "pg.log")
const dataDir = join(stateDir, "data")

const command = process.argv[2]
try {
  if (command === "start") await start()
  else if (command === "stop") stop()
  else if (command === "ports") await ports()
  else {
    console.error("usage: postgres.mjs start | stop | ports")
    process.exit(2)
  }
} catch (error) {
  console.error(`postgres.mjs ${command}: ${error.message}`)
  process.exit(1)
}

async function start() {
  if (existsSync(stateFile)) {
    throw new Error(
      `an instance is already running (${stateFile}); run stop first`
    )
  }
  const mode =
    process.env.NABA_PG_MODE ??
    (process.platform === "darwin" ? "native" : "docker")
  const port = await freePort()
  rmSync(stateDir, { recursive: true, force: true })
  mkdirSync(stateDir, { recursive: true })

  const state = { mode, port }
  try {
    if (mode === "docker") startDocker(state)
    else if (mode === "native") startNative(state)
    else throw new Error(`unknown NABA_PG_MODE ${mode}`)
  } catch (error) {
    printLog(state)
    stop(state)
    throw error
  }

  const host = `127.0.0.1:${port}/${DATABASE}`
  const runtime = `postgresql://${RUNTIME_ROLE}:${RUNTIME_ROLE}@${host}`
  exportVars({
    DIRECT_DATABASE_URL: `postgresql://${SUPERUSER}:${PASSWORD}@${host}`,
    DATABASE_URL: runtime,
    TEST_RUNTIME_DATABASE_URL: runtime,
    NABA_PG_PORT: String(port),
  })
  console.error(
    `PostgreSQL (${mode}) ready on 127.0.0.1:${port}, database ${DATABASE}`
  )
}

function startDocker(state) {
  state.container = instance.toLowerCase()
  writeState(state)
  run("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    state.container,
    "-p",
    `127.0.0.1:${state.port}:5432`,
    "-e",
    `POSTGRES_PASSWORD=${PASSWORD}`,
    "-e",
    `POSTGRES_DB=${DATABASE}`,
    IMAGE,
    "-c",
    "fsync=off",
    "-c",
    "synchronous_commit=off",
    "-c",
    "full_page_writes=off",
  ])
  // The image's entrypoint runs a socket-only temporary server during init,
  // so only a TCP check proves the final server is up.
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const probe = spawnSync("docker", [
      "exec",
      state.container,
      "pg_isready",
      "-h",
      "127.0.0.1",
      "-U",
      SUPERUSER,
      "-d",
      DATABASE,
    ])
    if (probe.status === 0) return
    sleep(250)
  }
  throw new Error("timed out waiting for the container to accept connections")
}

function startNative(state) {
  const bin = nativeBin()
  const version = run(join(bin, "initdb"), ["--version"]).trim()
  if (!/\b17\./.test(version)) {
    throw new Error(`need PostgreSQL 17 binaries, found "${version}" in ${bin}`)
  }
  state.bin = bin
  state.dataDir = dataDir
  writeState(state)

  const pwfile = join(stateDir, "pwfile")
  writeFileSync(pwfile, `${PASSWORD}\n`, { mode: 0o600 })
  run(join(bin, "initdb"), [
    "-D",
    dataDir,
    "-U",
    SUPERUSER,
    "--auth=scram-sha-256",
    `--pwfile=${pwfile}`,
    "-E",
    "UTF8",
    "--locale=en_US.UTF-8",
  ])
  rmSync(pwfile)
  // TCP only: no Unix socket, so long temp paths never hit the 103-byte limit.
  appendFileSync(
    join(dataDir, "postgresql.conf"),
    [
      "",
      `port = ${state.port}`,
      "listen_addresses = '127.0.0.1'",
      "unix_socket_directories = ''",
      "fsync = off",
      "synchronous_commit = off",
      "full_page_writes = off",
      "",
    ].join("\n")
  )
  run(join(bin, "pg_ctl"), [
    "-D",
    dataDir,
    "-l",
    logFile,
    "-w",
    "-t",
    "60",
    "start",
  ])
  run(
    join(bin, "createdb"),
    ["-h", "127.0.0.1", "-p", String(state.port), "-U", SUPERUSER, DATABASE],
    {
      env: { ...process.env, PGPASSWORD: PASSWORD },
    }
  )
}

function nativeBin() {
  if (process.env.NABA_PG_BIN) return process.env.NABA_PG_BIN
  try {
    const prefix = execFileSync("brew", ["--prefix", "postgresql@17"], {
      encoding: "utf8",
    }).trim()
    const bin = join(prefix, "bin")
    if (existsSync(join(bin, "initdb"))) return bin
  } catch {
    // fall through to the error below
  }
  throw new Error(
    "PostgreSQL 17 not found: brew install postgresql@17, or set NABA_PG_BIN"
  )
}

function stop(known) {
  const state = known ?? readState()
  if (state?.mode === "docker" && state.container) {
    spawnSync("docker", ["rm", "-f", "-v", state.container], {
      stdio: "ignore",
    })
  }
  if (
    state?.mode === "native" &&
    state.bin &&
    existsSync(join(state.dataDir, "postmaster.pid"))
  ) {
    spawnSync(
      join(state.bin, "pg_ctl"),
      ["-D", state.dataDir, "-m", "immediate", "-w", "stop"],
      {
        stdio: "ignore",
      }
    )
  }
  if (known) {
    // Failed start: keep pg.log for debugging, drop everything else.
    rmSync(stateFile, { force: true })
    rmSync(dataDir, { recursive: true, force: true })
  } else {
    rmSync(stateDir, { recursive: true, force: true })
    console.error(
      state ? `Stopped ${instance}` : `Nothing to stop for ${instance}`
    )
  }
}

async function ports() {
  // The e2e Google stub listens on PLAYWRIGHT_PORT + 1, so both must be free.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await freePort()
    if (port < 65535 && (await isFree(port + 1))) {
      exportVars({ PLAYWRIGHT_PORT: String(port) })
      return
    }
  }
  throw new Error("could not find two adjacent free ports")
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function isFree(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once("error", () => resolve(false))
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)))
  })
}

function exportVars(vars) {
  if (process.env.GITHUB_ENV) {
    appendFileSync(
      process.env.GITHUB_ENV,
      Object.entries(vars)
        .map(([key, value]) => `${key}=${value}\n`)
        .join("")
    )
    for (const key of Object.keys(vars)) console.error(`Exported ${key}`)
  } else {
    for (const [key, value] of Object.entries(vars))
      console.log(`export ${key}='${value}'`)
  }
}

function printLog(state) {
  if (state.mode === "native" && existsSync(logFile)) {
    console.error(`--- ${logFile} ---\n${readFileSync(logFile, "utf8")}`)
  }
  if (state.mode === "docker" && state.container) {
    spawnSync("docker", ["logs", state.container], {
      stdio: ["ignore", "inherit", "inherit"],
    })
  }
}

function readState() {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"))
  } catch {
    return null
  }
}

function writeState(state) {
  writeFileSync(stateFile, JSON.stringify(state))
}

function run(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: "utf8", ...options })
  if (result.error) throw new Error(`${file}: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(
      `${file} ${args.join(" ")} exited ${result.status}\n${result.stderr}${result.stdout}`
    )
  }
  return result.stdout
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
