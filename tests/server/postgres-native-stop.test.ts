import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

// scripts/ci/postgres.mjs stopping a native cluster, run for real against a
// stub pg_ctl. Its `stop` exits STUB_STOP_EXIT (0 by default) and removes
// postmaster.pid when STUB_STOP_REMOVES_PID is set; its `status` exits
// STUB_STATUS_EXIT (3 by default, pg_ctl's "no server running").
const script = fileURLToPath(
  new URL("../../scripts/ci/postgres.mjs", import.meta.url)
)

const STUB_PG_CTL = `#!/bin/sh
echo "$*" >> "$STUB_LOG"
data=""
while [ $# -gt 0 ]; do
  case "$1" in
    -D) data=$2; shift 2 ;;
    stop)
      [ -n "$STUB_STOP_REMOVES_PID" ] && rm -f "$data/postmaster.pid"
      exit "\${STUB_STOP_EXIT:-0}" ;;
    status) exit "\${STUB_STATUS_EXIT:-3}" ;;
    *) shift ;;
  esac
done
exit 2
`

describe("postgres.mjs stopping a native cluster", () => {
  let root: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "naba-pg-native-")))
    mkdirSync(join(root, "bin"))
    writeFileSync(join(root, "bin", "pg_ctl"), STUB_PG_CTL)
    chmodSync(join(root, "bin", "pg_ctl"), 0o755)
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  // What postgres.mjs start leaves behind: state naming the bin and data
  // directories, and the postmaster.pid of a running server.
  function cluster(name: string, { running = true } = {}) {
    const dir = join(root, name)
    mkdirSync(join(dir, "data"), { recursive: true })
    writeFileSync(
      join(dir, "state.json"),
      JSON.stringify({
        mode: "native",
        port: 1,
        bin: join(root, "bin"),
        dataDir: join(dir, "data"),
      })
    )
    if (running) writeFileSync(join(dir, "data", "postmaster.pid"), "4242\n")
    return { dir, data: join(dir, "data") }
  }
  const stop = (dir: string, stub: Record<string, string> = {}) =>
    spawnSync(process.execPath, [script, "stop"], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: root,
        NODE_ENV: "test",
        NABA_PG_DIR: dir,
        SHARD: "native",
        STUB_LOG: join(root, "pg_ctl.log"),
        ...stub,
      },
    })
  const calls = () =>
    existsSync(join(root, "pg_ctl.log"))
      ? readFileSync(join(root, "pg_ctl.log"), "utf8").trim().split("\n")
      : []

  it("deletes the state once pg_ctl reports no server running", () => {
    const { dir, data } = cluster("a")
    const stopped = stop(dir, { STUB_STOP_REMOVES_PID: "1" })
    expect(stopped.status, stopped.stderr).toBe(0)
    expect(calls()).toEqual([
      `-D ${data} -m immediate -w stop`,
      `-D ${data} status`,
    ])
    expect(existsSync(dir)).toBe(false)
  })

  it("keeps the state when the shutdown fails, so stop can be retried", () => {
    const { dir, data } = cluster("b")
    const failed = stop(dir, { STUB_STOP_EXIT: "1", STUB_STATUS_EXIT: "0" })
    expect(failed.status).toBe(1)
    expect(failed.stderr).toContain(
      "PostgreSQL cleanup failed (pg_ctl stop exit 1, status exit 0); preserving state"
    )
    expect(existsSync(join(dir, "state.json"))).toBe(true)
    expect(existsSync(join(data, "postmaster.pid"))).toBe(true)

    const retried = stop(dir, { STUB_STOP_REMOVES_PID: "1" })
    expect(retried.status, retried.stderr).toBe(0)
    expect(existsSync(dir)).toBe(false)
  })

  it("keeps the state when pg_ctl cannot confirm the server is gone", () => {
    // The stop reported success, but status could not prove it (exit 4:
    // no accessible data directory).
    const { dir } = cluster("c")
    const unconfirmed = stop(dir, {
      STUB_STOP_REMOVES_PID: "1",
      STUB_STATUS_EXIT: "4",
    })
    expect(unconfirmed.status).toBe(1)
    expect(unconfirmed.stderr).toContain("status exit 4")
    expect(existsSync(join(dir, "state.json"))).toBe(true)
  })

  it("counts a postmaster.pid left by a server that already died as stopped", () => {
    // pg_ctl stop fails on a dead PID; status still proves no server runs.
    const { dir } = cluster("d")
    const stopped = stop(dir, { STUB_STOP_EXIT: "1" })
    expect(stopped.status, stopped.stderr).toBe(0)
    expect(existsSync(dir)).toBe(false)
  })

  it("leaves pg_ctl alone when the server never started", () => {
    const { dir } = cluster("e", { running: false })
    const stopped = stop(dir)
    expect(stopped.status, stopped.stderr).toBe(0)
    expect(calls()).toEqual([])
    expect(existsSync(dir)).toBe(false)
  })
})
