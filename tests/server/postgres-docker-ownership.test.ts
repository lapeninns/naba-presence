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
// `docker` that keeps a registry of containers by name and by full ID and
// behaves as the Docker CLI does: a duplicate name exits 125 with no
// --cidfile, `rm -f` of a container that is already gone exits 0, and
// STUB_DOCKER_RUN_FAIL creates the container and writes the cidfile before
// run fails (a host port taken in between).
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
    if [ -n "$STUB_DOCKER_RUN_FAIL" ]; then
      echo "Error response from daemon: Bind for 127.0.0.1 failed: port is already allocated" >&2
      exit 125
    fi
    echo "$id"
    ;;
  rm)
    target=""; force=""
    for arg in "$@"; do [ "$arg" = "-f" ] && force=1; target=$arg; done
    if [ -n "$STUB_DOCKER_RM_FAIL" ]; then echo "simulated failure" >&2; exit 1; fi
    if [ -e "$reg/ids/$target" ]; then
      name=$(cat "$reg/ids/$target"); rm -f "$reg/ids/$target" "$reg/names/$name"
    elif [ -e "$reg/names/$target" ]; then
      id=$(cat "$reg/names/$target"); rm -f "$reg/names/$target" "$reg/ids/$id"
    else
      echo "Error response from daemon: No such container: $target" >&2
      [ -n "$force" ] && exit 0
      exit 1
    fi
    echo "$target"
    ;;
  logs) echo "stub log of $1" ;;
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
    // not reach the first run's container (it used to `docker rm` by name):
    // its only docker call is the refused run.
    const before = calls().length
    const second = postgres("start", "b", "same")
    expect(second.status).not.toBe(0)
    expect(second.stderr).toContain("already in use")
    expect(
      calls()
        .slice(before)
        .map((call) => call.split(" ")[0])
    ).toEqual(["run"])
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

  it("reports a failed start, not its failed cleanup, and keeps the ID", () => {
    // Docker created the container and wrote the cidfile, then the run
    // failed; removing it fails too.
    const failed = postgres("start", "d", "pair", {
      STUB_DOCKER_RUN_FAIL: "1",
      STUB_DOCKER_RM_FAIL: "1",
    })
    expect(failed.status).toBe(1)
    // The container's log goes to stderr: stdout is for `eval` export lines.
    expect(failed.stdout).toBe("")
    expect(failed.stderr).toContain("stub log of")
    expect(failed.stderr).toContain("Docker cleanup failed")
    const reported = failed.stderr.slice(
      failed.stderr.lastIndexOf("postgres.mjs start: ")
    )
    expect(reported).toContain("port is already allocated")
    expect(reported).not.toContain("Docker cleanup failed")

    // state.json never learnt the ID; stop recovers it from the cidfile.
    expect(stateOf("d")).toEqual({ mode: "docker", port: expect.any(Number) })
    const id = readFileSync(join(root, "d", "container.id"), "utf8")
    expect(id).toMatch(/^[a-f0-9]{64}$/)
    expect(live()).toEqual(["naba-pg-local-pair"])

    const retried = postgres("stop", "d", "pair")
    expect(retried.status, retried.stderr).toBe(0)
    expect(calls()).toContain(`rm -f -v ${id}`)
    expect(live()).toEqual([])
    expect(existsSync(join(root, "d"))).toBe(false)
  })

  it("stops cleanly when its container is already gone", () => {
    expect(postgres("start", "e", "gone").status).toBe(0)
    const { container = "" } = stateOf("e")
    expect(container).toMatch(/^[a-f0-9]{64}$/)
    // Removed outside this run (a daemon restart, a manual `docker rm`).
    rmSync(join(registry, "names", "naba-pg-local-gone"))
    rmSync(join(registry, "ids", container))

    const stopped = postgres("stop", "e", "gone")
    expect(stopped.status, stopped.stderr).toBe(0)
    expect(calls()).toContain(`rm -f -v ${container}`)
    expect(existsSync(join(root, "e"))).toBe(false)
  })

  it("keeps the state when docker run recorded no ID", () => {
    // A CLI killed between creating the cidfile and writing the ID.
    mkdirSync(join(root, "empty"))
    writeFileSync(
      join(root, "empty", "state.json"),
      JSON.stringify({ mode: "docker", port: 1 })
    )
    writeFileSync(join(root, "empty", "container.id"), "")
    const stopped = postgres("stop", "empty", "empty")
    expect(stopped.status).toBe(1)
    expect(stopped.stderr).toContain("recorded no container ID")
    expect(calls()).toEqual([])
    expect(existsSync(join(root, "empty", "state.json"))).toBe(true)
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
    expect(calls()).toEqual([])
    expect(live()).toEqual(["naba-pg-local-legacy"])
    expect(existsSync(join(root, "legacy", "state.json"))).toBe(true)
  })
})
