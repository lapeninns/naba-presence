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

// scripts/ci/postgres.mjs on its docker path, run for real against a stub
// `docker` that keeps a registry of containers by name and by full ID, and
// refuses a duplicate name the way Docker does (exit 125, no --cidfile).
const script = fileURLToPath(
  new URL("../../scripts/ci/postgres.mjs", import.meta.url)
)

const STUB_DOCKER = `#!/bin/sh
reg="$STUB_DOCKER_DIR"
mkdir -p "$reg/names" "$reg/ids"
echo "$*" >> "$reg/calls.log"
cmd=$1; shift
case "$cmd" in
  run)
    cid=""; name=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --cidfile) cid=$2; shift 2 ;;
        --name) name=$2; shift 2 ;;
        *) shift ;;
      esac
    done
    if [ -e "$reg/names/$name" ]; then
      echo "Conflict. The container name \\"/$name\\" is already in use" >&2
      exit 125
    fi
    id=$(printf '%s' "$name-$$-$(date +%s%N)" | shasum -a 256 | cut -c1-64)
    echo "$id" > "$reg/names/$name"
    echo "$name" > "$reg/ids/$id"
    [ -n "$cid" ] && printf '%s' "$id" > "$cid"
    echo "$id"
    ;;
  rm)
    target=""; for arg in "$@"; do target=$arg; done
    if [ -n "$STUB_DOCKER_RM_FAIL" ]; then echo "simulated failure" >&2; exit 1; fi
    if [ -e "$reg/ids/$target" ]; then
      name=$(cat "$reg/ids/$target"); rm -f "$reg/ids/$target" "$reg/names/$name"
    elif [ -e "$reg/names/$target" ]; then
      id=$(cat "$reg/names/$target"); rm -f "$reg/names/$target" "$reg/ids/$id"
    else
      echo "Error: No such container: $target" >&2; exit 1
    fi
    echo "$target"
    ;;
  *) exit 0 ;;
esac
`

describe("postgres.mjs on docker: only the container this run created", () => {
  let root: string
  let registry: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "naba-pg-docker-")))
    registry = join(root, "registry")
    mkdirSync(join(root, "bin"))
    writeFileSync(join(root, "bin", "docker"), STUB_DOCKER)
    chmodSync(join(root, "bin", "docker"), 0o755)
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const postgres = (
    command: "start" | "stop",
    pgDir: string,
    shard: string,
    extra: Record<string, string> = {}
  ) =>
    spawnSync(process.execPath, [script, command], {
      encoding: "utf8",
      env: {
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        HOME: root,
        NODE_ENV: "test",
        STUB_DOCKER_DIR: registry,
        NABA_PG_MODE: "docker",
        NABA_PG_DIR: join(root, pgDir),
        SHARD: shard,
        ...extra,
      },
    })
  const calls = () =>
    existsSync(join(registry, "calls.log"))
      ? readFileSync(join(registry, "calls.log"), "utf8").trim().split("\n")
      : []
  const live = () =>
    existsSync(join(registry, "names"))
      ? spawnSync("ls", [join(registry, "names")], { encoding: "utf8" })
          .stdout.trim()
          .split("\n")
          .filter(Boolean)
      : []
  const stateOf = (pgDir: string) =>
    JSON.parse(readFileSync(join(root, pgDir, "state.json"), "utf8")) as {
      mode: string
      container?: string
    }

  it("records the full container ID and removes exactly that container", () => {
    const started = postgres("start", "a", "same")
    expect(started.status, started.stderr).toBe(0)
    expect(started.stdout).toContain("export DIRECT_DATABASE_URL=")
    const { container } = stateOf("a")
    expect(container).toMatch(/^[a-f0-9]{64}$/)
    expect(live()).toEqual(["naba-pg-local-same"])

    const stopped = postgres("stop", "a", "same")
    expect(stopped.status, stopped.stderr).toBe(0)
    expect(calls()).toContain(`rm -f -v ${container}`)
    expect(live()).toEqual([])
    expect(existsSync(join(root, "a"))).toBe(false)
  })

  it("never removes another run's container when its name is taken", () => {
    expect(postgres("start", "a", "same").status).toBe(0)
    const owner = stateOf("a").container

    // A second run with the same name fails to start, and its cleanup must
    // not reach the first run's container (it used to `docker rm` by name).
    const second = postgres("start", "b", "same")
    expect(second.status).not.toBe(0)
    expect(second.stderr).toContain("already in use")
    expect(calls().filter((call) => call.startsWith("rm "))).toEqual([])
    expect(live()).toEqual(["naba-pg-local-same"])
    expect(stateOf("a").container).toBe(owner)
  })

  it("keeps the state for a retry when removal is uncertain", () => {
    expect(postgres("start", "c", "retry").status).toBe(0)
    const { container } = stateOf("c")

    const failed = postgres("stop", "c", "retry", { STUB_DOCKER_RM_FAIL: "1" })
    expect(failed.status).not.toBe(0)
    expect(failed.stderr).toContain("Docker cleanup failed")
    expect(stateOf("c").container).toBe(container)

    const retried = postgres("stop", "c", "retry")
    expect(retried.status, retried.stderr).toBe(0)
    expect(live()).toEqual([])
    expect(existsSync(join(root, "c"))).toBe(false)
  })

  it("refuses to remove a container it only knows by name", () => {
    // State written by the old script held the container name.
    mkdirSync(join(registry, "names"), { recursive: true })
    writeFileSync(join(registry, "names", "naba-pg-local-legacy"), "x")
    mkdirSync(join(root, "legacy"))
    writeFileSync(
      join(root, "legacy", "state.json"),
      JSON.stringify({
        mode: "docker",
        port: 1,
        container: "naba-pg-local-legacy",
      })
    )
    const stopped = postgres("stop", "legacy", "legacy")
    expect(stopped.status).not.toBe(0)
    expect(stopped.stderr).toContain("legacy name or invalid container ID")
    expect(calls().filter((call) => call.startsWith("rm "))).toEqual([])
    expect(existsSync(join(root, "legacy", "state.json"))).toBe(true)
  })
})
