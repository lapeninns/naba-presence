import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

// Runs the reference copies of the self-hosted runner's job hooks under bash,
// the way the runner does, with fixture GITHUB_* values. The live hooks on
// the Mac must match these files (runner-setup.sh verify checks that).
const HOOK_DIR = join(process.cwd(), "scripts/ci/runner-hooks")
const PRE_JOB = join(HOOK_DIR, "pre-job.sh")
const POST_JOB = join(HOOK_DIR, "post-job.sh")
const REPO = "lapeninns/naba-presence"

let root: string
let stubBin: string
let pkillLog: string
let hookPath: string
let bash: string
// Two runner instances under one user, as runner-setup.sh installs them.
// mac-10 (not mac-2) also proves a path prefix is not a match.
let mine: { temp: string; workspace: string }
let other: { temp: string; workspace: string }

function instance(name: string) {
  const work = join(root, "actions-runner", name, "_work")
  const temp = join(work, "_temp")
  const workspace = join(work, "naba-presence", "naba-presence")
  mkdirSync(temp, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  return { temp, workspace }
}

function resolveOnPath(command: string, path = process.env.PATH ?? "") {
  const found = spawnSync("/bin/sh", ["-c", `command -v ${command}`], {
    env: { NODE_ENV: "test", PATH: path },
    encoding: "utf8",
  })
  return found.status === 0 ? found.stdout.trim() : null
}

beforeAll(() => {
  // realpath: macOS reports /private/var/... as a process's cwd.
  root = realpathSync(mkdtempSync(join(tmpdir(), "naba-runner-hook-")))
  stubBin = join(root, "stub-bin")
  mkdirSync(stubBin)
  pkillLog = join(root, "pkill.log")
  // The hooks must never pkill by user again (NP3-002). A stub first on PATH
  // records any call instead of killing this machine's processes.
  writeFileSync(
    join(stubBin, "pkill"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${pkillLog}'\nexit 0\n`
  )
  chmodSync(join(stubBin, "pkill"), 0o755)
  const jq = resolveOnPath("jq")
  hookPath = [
    stubBin,
    jq ? dirname(jq) : null,
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ]
    .filter(Boolean)
    .join(":")
  // The runner's PATH puts the system bash (3.2 on macOS) first unless
  // Homebrew bash is installed; resolve it the same way.
  bash = resolveOnPath("bash", hookPath) ?? "bash"
  mine = instance("mac-1")
  other = instance("mac-10")
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function eventFile(name: string, payload: unknown) {
  const file = join(root, `${name}.json`)
  writeFileSync(file, JSON.stringify(payload))
  return file
}

function pullRequest({
  head = REPO,
  base = REPO,
  author = "lapeninns",
}: { head?: string | null; base?: string; author?: string } = {}) {
  return {
    pull_request: {
      head: { repo: head === null ? null : { full_name: head } },
      base: { repo: { full_name: base } },
      user: { login: author },
    },
  }
}

/** Per test, so one hook's pkill call is reported by its own test only. */
function expectNoPkill() {
  const called = existsSync(pkillLog)
  rmSync(pkillLog, { force: true })
  expect(called, "a hook called pkill").toBe(false)
}

type HookEnv = Record<string, string | undefined>

function runHook(script: string, env: HookEnv, cwd = mine.workspace) {
  const result = spawnSync(bash, [script], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      NODE_ENV: "test",
      ...Object.fromEntries(
        Object.entries({
          PATH: hookPath,
          HOME: root,
          RUNNER_TEMP: mine.temp,
          GITHUB_WORKSPACE: mine.workspace,
          GITHUB_REPOSITORY: REPO,
          GITHUB_ACTOR: "lapeninns",
          ...env,
        }).filter((entry): entry is [string, string] => entry[1] !== undefined)
      ),
    },
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function preJob(env: HookEnv) {
  return runHook(PRE_JOB, env)
}

const onMain = (event: string): HookEnv => ({
  GITHUB_EVENT_NAME: event,
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_PATH: eventFile(event, {}),
})

const prEvent = (payload: unknown, env: HookEnv = {}): HookEnv => ({
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_REF: "refs/pull/7/merge",
  GITHUB_EVENT_PATH: eventFile(
    `pr-${Math.random().toString(36).slice(2)}`,
    payload
  ),
  ...env,
})

describe("self-hosted pre-job hook: trust rule", () => {
  afterEach(() => {
    expectNoPkill()
  })

  it.each(["push", "schedule", "workflow_dispatch"])(
    "allows %s on main",
    (event) => {
      const run = preJob(onMain(event))
      expect(run.stderr).toBe("")
      expect(run.status).toBe(0)
      expect(run.stdout).toContain(`allowed ${event} on refs/heads/main`)
    }
  )

  it("allows a same-repository pull request", () => {
    const run = preJob(prEvent(pullRequest()))
    expect(run.stderr).toBe("")
    expect(run.status).toBe(0)
    expect(run.stdout).toContain("allowed pull_request on refs/pull/7/merge")
  })

  const denied: Array<[string, () => HookEnv, string]> = [
    [
      "a fork pull request",
      () => prEvent(pullRequest({ head: "someone/naba-presence" })),
      "cross-repository pull request from someone/naba-presence",
    ],
    [
      "a pull request whose head repository was deleted",
      () => prEvent(pullRequest({ head: null })),
      "cross-repository pull request from unknown",
    ],
    [
      "a Dependabot-authored pull request",
      () => prEvent(pullRequest({ author: "dependabot[bot]" })),
      "Dependabot pull request",
    ],
    [
      "a pull request run by the Dependabot actor",
      () => prEvent(pullRequest(), { GITHUB_ACTOR: "dependabot[bot]" }),
      "Dependabot actor",
    ],
    [
      "a push to another branch",
      () => ({ ...onMain("push"), GITHUB_REF: "refs/heads/feature" }),
      "push on refs/heads/feature",
    ],
    [
      "a dispatch on a tag",
      () => ({ ...onMain("workflow_dispatch"), GITHUB_REF: "refs/tags/v1" }),
      "workflow_dispatch on refs/tags/v1",
    ],
    [
      "a schedule without a ref",
      () => ({ ...onMain("schedule"), GITHUB_REF: undefined }),
      "schedule on unset",
    ],
    [
      "pull_request_target, even from the same repository on main",
      () => ({
        ...prEvent(pullRequest()),
        GITHUB_EVENT_NAME: "pull_request_target",
        GITHUB_REF: "refs/heads/main",
      }),
      "event pull_request_target",
    ],
    [
      "issue_comment",
      () => ({ ...onMain("issue_comment") }),
      "event issue_comment",
    ],
    [
      "workflow_run",
      () => ({ ...onMain("workflow_run") }),
      "event workflow_run",
    ],
    [
      "a missing event name",
      () => ({ ...onMain("push"), GITHUB_EVENT_NAME: undefined }),
      "event unset",
    ],
    [
      "another repository",
      () => ({ ...onMain("push"), GITHUB_REPOSITORY: "someone/naba-presence" }),
      "repository someone/naba-presence",
    ],
    [
      "a missing repository",
      () => ({ ...onMain("push"), GITHUB_REPOSITORY: undefined }),
      "repository unset",
    ],
    [
      "a missing event file",
      () => ({
        ...onMain("push"),
        GITHUB_EVENT_PATH: join(root, "absent.json"),
      }),
      "no GITHUB_EVENT_PATH",
    ],
    [
      "an unset event path",
      () => ({ ...onMain("push"), GITHUB_EVENT_PATH: undefined }),
      "no GITHUB_EVENT_PATH",
    ],
    [
      "a machine without jq",
      // Empty PATH: bash is spawned by absolute path, jq cannot be found.
      () => ({ ...prEvent(pullRequest()), PATH: join(root, "empty-bin") }),
      "jq is not installed",
    ],
  ]

  it.each(denied)("denies %s", (_name, env, reason) => {
    const run = preJob(env())
    expect(run.status).toBe(1)
    expect(run.stderr.trim()).toBe(
      `naba runner pre-job hook: refusing job: ${reason}`
    )
    expect(run.stdout).not.toContain("allowed")
  })
})

// A long-lived node process standing in for postgres, the standalone server
// or a browser. `argPath` puts a path on its command line (like
// `postgres -D $RUNNER_TEMP/...`); `cwd` is where it runs (like
// `node .next/standalone/server.js` from the workspace).
function decoy({ cwd = root, argPath }: { cwd?: string; argPath?: string }) {
  mkdirSync(cwd, { recursive: true })
  const child = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)", ...(argPath ? [argPath] : [])],
    { cwd, stdio: "ignore" }
  )
  return child
}

const decoys: ChildProcess[] = []

function started(options: { cwd?: string; argPath?: string }) {
  const child = decoy(options)
  decoys.push(child)
  return child
}

const alive = (child: ChildProcess) =>
  child.exitCode === null && child.signalCode === null

async function exited(child: ChildProcess, ms = 10_000) {
  if (!alive(child)) return true
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    child.once("exit", () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

async function spawnedAll(children: ChildProcess[]) {
  await Promise.all(
    children.map(
      (child) => new Promise((resolve) => child.once("spawn", resolve))
    )
  )
  // Give each node process time to chdir and exec fully before ps/lsof look.
  await new Promise((resolve) => setTimeout(resolve, 300))
}

describe("self-hosted job hooks: cleanup is scoped to the job", () => {
  afterEach(() => {
    for (const child of decoys.splice(0))
      if (alive(child)) child.kill("SIGKILL")
    expectNoPkill()
  })

  function jobAndNeighbours() {
    const ownServer = started({
      cwd: join(mine.workspace, ".next", "standalone"),
    })
    const ownPostgres = started({ argPath: join(mine.temp, "naba-pg", "data") })
    const otherServer = started({
      cwd: join(other.workspace, ".next", "standalone"),
    })
    const otherPostgres = started({
      argPath: join(other.temp, "naba-pg", "data"),
    })
    // Same user, outside any job folder (the runner listener, the owner's
    // own processes when run locally).
    const unrelated = started({ cwd: root })
    return { ownServer, ownPostgres, otherServer, otherPostgres, unrelated }
  }

  it("pre-job stops this instance's leftovers and leaves the other instance's live job running", async () => {
    const p = jobAndNeighbours()
    await spawnedAll(Object.values(p))

    const run = preJob(onMain("push"))
    expect(run.status).toBe(0)

    expect(await exited(p.ownServer)).toBe(true)
    expect(await exited(p.ownPostgres)).toBe(true)
    expect(alive(p.otherServer)).toBe(true)
    expect(alive(p.otherPostgres)).toBe(true)
    expect(alive(p.unrelated)).toBe(true)
  })

  it("a refused job stops nothing", async () => {
    const p = jobAndNeighbours()
    await spawnedAll(Object.values(p))

    const run = preJob(prEvent(pullRequest({ head: "someone/naba-presence" })))
    expect(run.status).toBe(1)

    for (const child of Object.values(p)) expect(alive(child)).toBe(true)
  })

  it("post-job stops this job's processes, deletes the whole workspace and empties RUNNER_TEMP", async () => {
    const p = jobAndNeighbours()
    await spawnedAll(Object.values(p))
    mkdirSync(join(mine.workspace, ".git", "hooks"), { recursive: true })
    writeFileSync(
      join(mine.workspace, ".git", "config"),
      "[core]\n\tfsmonitor = /tmp/x\n"
    )
    writeFileSync(join(mine.workspace, "tracked.txt"), "x")
    writeFileSync(join(mine.temp, ".hidden"), "x")
    writeFileSync(join(other.workspace, "keep.txt"), "x")
    writeFileSync(join(other.temp, "keep.txt"), "x")

    const run = runHook(POST_JOB, onMain("push"))
    expect(run.status).toBe(0)
    expect(run.stdout).toContain(
      `post-job: deleted workspace ${mine.workspace}`
    )

    expect(await exited(p.ownServer)).toBe(true)
    expect(await exited(p.ownPostgres)).toBe(true)
    expect(alive(p.otherServer)).toBe(true)
    expect(alive(p.otherPostgres)).toBe(true)
    expect(alive(p.unrelated)).toBe(true)

    expect(readdirSync(mine.workspace)).toEqual([])
    expect(readdirSync(mine.temp)).toEqual([])
    expect(existsSync(join(other.workspace, "keep.txt"))).toBe(true)
    expect(existsSync(join(other.temp, "keep.txt"))).toBe(true)
  })

  it("post-job never deletes a workspace outside a runner _work folder", () => {
    const outside = join(root, "not-a-runner", "checkout")
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, "keep.txt"), "x")

    for (const workspace of [outside, root, "/", ""]) {
      const run = runHook(
        POST_JOB,
        { ...onMain("push"), GITHUB_WORKSPACE: workspace },
        root
      )
      expect(run.status).toBe(0)
      expect(run.stdout).not.toContain("deleted workspace")
    }
    expect(existsSync(join(outside, "keep.txt"))).toBe(true)
  })

  it("an unset RUNNER_TEMP and workspace stop nothing", async () => {
    const p = jobAndNeighbours()
    await spawnedAll(Object.values(p))

    const run = runHook(
      POST_JOB,
      {
        ...onMain("push"),
        RUNNER_TEMP: undefined,
        GITHUB_WORKSPACE: undefined,
      },
      root
    )
    expect(run.status).toBe(0)
    for (const child of Object.values(p)) expect(alive(child)).toBe(true)
  })
})
