import assert from "node:assert/strict"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runInNewContext } from "node:vm"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  GATE_STEPS,
  LOCAL_RECEIPTS_DIR,
  buildLocalReceipt,
  gateProblems,
  gateSourceChanges,
  latestPromotedRelease,
  localReceiptFileName,
  localReceiptProblems,
} from "../../scripts/release/local-receipt.mjs"
import {
  CI_PLACEHOLDER_ENV,
  CpuBudget,
  DEFAULT_INTEGRATION_SHARDS,
  HEAVY_STEP_PRIORITY,
  SECRET_SCAN_ARGS,
  acquireUnlessStopped,
  childEnv,
  defaultCpuBudget,
  gateRunRoot,
  heavyStepWeights,
  mergePlaywrightSummaries,
  mergeVitestSummaries,
  normalizeSchemaDump,
  outputCollector,
  parseArgs,
  parseExports,
  releaseAfter,
  summarizeOutput,
} from "../../scripts/release/verify-local.mjs"
import { readRepoText } from "../helpers/repo-text"

const SHA = "0123456789abcdef0123456789abcdef01234567"
const PROD_SHA = "fedcba9876543210fedcba9876543210fedcba98"
const repoRoot = fileURLToPath(new URL("../../", import.meta.url))

type StepResult = {
  id: string
  status: "passed" | "failed" | "skipped" | "not-run"
  durationMs: number
  summary?: string[]
  note?: string
  exitCode?: number | null
}

// What summarizeOutput keeps from a real run of each test step.
const TEST_SUMMARIES: Record<string, string[]> = {
  integration: ["Test Files 143 passed (143)", "Tests 1254 passed (1254)"],
  e2e: ["572 passed (19.1m)"],
}

const allPassed = (): StepResult[] =>
  GATE_STEPS.map((step: { id: string }) => ({
    id: step.id,
    status: "passed" as const,
    durationMs: 12.6,
    ...(TEST_SUMMARIES[step.id] ? { summary: TEST_SUMMARIES[step.id] } : {}),
  }))

const receiptInput = (steps: StepResult[]) => ({
  sha: SHA,
  base: {
    ref: PROD_SHA,
    sha: PROD_SHA,
    mergeBase: PROD_SHA,
    source: "promotion-receipt",
  },
  gateSource: { clean: true, changed: [] },
  toolchain: { node: "v24.18.0", pnpm: "10.34.5", postgres: null },
  steps,
  options: { skip: [], failFast: false },
  startedAt: "2026-10-10T11:00:00.000Z",
  finishedAt: "2026-10-10T11:20:00.123Z",
})

describe("verify:release steps", () => {
  it("is the whole CI graph, and ci.yml runs it rather than restating it", () => {
    const ids = GATE_STEPS.map((step: { id: string }) => step.id)
    expect(ids).toEqual([
      "frozen-install",
      "typecheck",
      "lint",
      "unit",
      "format",
      "design",
      "build",
      "bundle-budget",
      "migration-policy",
      "migrate-fresh",
      "migrate-upgrade",
      "migrate-concurrent",
      "integration",
      "e2e",
      "audit",
      "workflow-lint",
      "secret-scan",
    ])
    // Every step is required, the secret scan included (SEC-13 follow-up),
    // except the workflow lint, whose tools may be missing.
    expect(
      GATE_STEPS.filter((step: { required: boolean }) => !step.required).map(
        (step: { id: string }) => step.id
      )
    ).toEqual(["workflow-lint"])
    const ci = readRepoText(".github/workflows/ci.yml")
    expect(ci).toContain("node scripts/release/verify-local.mjs")
  })

  it("orders every step after the steps it needs", () => {
    const seen = new Set<string>()
    for (const step of GATE_STEPS as { id: string; needs: string[] }[]) {
      for (const need of step.needs) {
        expect(seen.has(need), `${step.id} needs ${need}`).toBe(true)
      }
      seen.add(step.id)
    }
    // Anything that runs project code waits for the install; the database
    // and browser suites wait for the build they start.
    const needsOf = (id: string) =>
      (GATE_STEPS as { id: string; needs: string[] }[]).find(
        (step) => step.id === id
      )!.needs
    for (const id of [
      "typecheck",
      "lint",
      "unit",
      "format",
      "design",
      "build",
    ]) {
      expect(needsOf(id)).toContain("frozen-install")
    }
    expect(needsOf("integration")).toContain("build")
    expect(needsOf("e2e")).toContain("build")
    expect(needsOf("bundle-budget")).toContain("build")
    expect(needsOf("migrate-upgrade")).toContain("migrate-fresh")
  })

  it("scans the released commit's history, not every ref the worktree shares", () => {
    expect(SECRET_SCAN_ARGS).toEqual([
      "git",
      "--no-banner",
      "--redact",
      "--log-opts=HEAD",
      ".",
    ])
    // The step passes exactly these arguments, and only it runs gitleaks.
    const source = readRepoText("scripts/release/verify-local.mjs")
    expect(source).toContain('must(sink, "gitleaks", [...SECRET_SCAN_ARGS])')
    expect(source.match(/must\(sink, "gitleaks"/g)).toHaveLength(1)
  })

  it("uses ci.yml's placeholder environment exactly", () => {
    const ci = readRepoText(".github/workflows/ci.yml")
    const block = /\nenv:\n((?: {2}.*\n|\n)+)/.exec(ci)?.[1] ?? ""
    const values = Object.fromEntries(
      [...block.matchAll(/^ {2}([A-Z_]+):\s*"?([^"\n]+?)"?\s*$/gm)].map(
        (match) => [match[1], match[2]]
      )
    )
    expect(values).toEqual(CI_PLACEHOLDER_ENV)
  })

  it("passes only allowlisted variables through and adds the placeholders", () => {
    const shell = {
      PATH: "/usr/bin",
      HOME: "/home/x",
      PNPM_HOME: "/home/x/.pnpm",
      npm_config_registry: "https://registry.npmjs.org/",
      NABA_PG_BIN: "/opt/pg/bin",
      DATABASE_URL: "postgresql://u:p@127.0.0.1:54322/postgres",
      DATABASE_SESSION_URL: "postgresql://u:p@127.0.0.1:54322/postgres",
      DIRECT_DATABASE_URL: "postgresql://u:p@db.example.test/postgres",
      ALLOW_REMOTE_TEST_DB: "1",
      GITHUB_ENV: "/tmp/env",
      CI: "true",
      NODE_ENV: "production",
      NEXTAUTH_SECRET: "real-secret-from-shell",
      // Sourced from a production env file: never reaches the steps.
      EMAIL_API_KEY: "re_live_key",
      EMAIL_FROM: "ops@example.test",
      TENANT_EMAIL_ENABLED: "true",
      GOOGLE_PLACES_API_KEY: "live-places-key",
      RUNTIME_ROLE_PASSWORD: "prod-role-password",
      VERCEL_GIT_COMMIT_SHA: SHA,
      UNSET: undefined,
    }
    const env = childEnv(shell)
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/x",
      PNPM_HOME: "/home/x/.pnpm",
      npm_config_registry: "https://registry.npmjs.org/",
      NABA_PG_BIN: "/opt/pg/bin",
      ...CI_PLACEHOLDER_ENV,
      LC_ALL: "en_US.UTF-8",
      LANG: "en_US.UTF-8",
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    })
  })

  it("parses arguments and rejects unknown steps", () => {
    expect(parseArgs([])).toMatchObject({
      skip: [],
      failFast: false,
      baseRef: null,
      receiptsDir: null,
      keepWorktree: false,
      serial: false,
      integrationShards: DEFAULT_INTEGRATION_SHARDS,
    })
    expect(parseArgs(["--serial", "--integration-shards", "2"])).toMatchObject({
      serial: true,
      integrationShards: 2,
    })
    // --serial alone means one shard; an explicit count still wins.
    expect(parseArgs(["--serial"]).integrationShards).toBe(1)
    expect(
      parseArgs(["--serial"], { NABA_GATE_INTEGRATION_SHARDS: "2" })
        .integrationShards
    ).toBe(2)
    expect(
      parseArgs([], { NABA_GATE_INTEGRATION_SHARDS: "3" }).integrationShards
    ).toBe(3)
    expect(
      parseArgs(["--integration-shards", "1"], {
        NABA_GATE_INTEGRATION_SHARDS: "3",
      }).integrationShards
    ).toBe(1)
    for (const bad of ["0", "17", "two", "1.5", ""]) {
      expect(() => parseArgs(["--integration-shards", bad])).toThrow(
        /--integration-shards/
      )
    }
    expect(
      parseArgs(["--skip", "e2e,audit", "--skip", "e2e", "--fail-fast"])
    ).toMatchObject({ skip: ["e2e", "audit"], failFast: true })
    expect(() => parseArgs(["--skip", "deploy"])).toThrow(/Unknown step/)
    expect(() => parseArgs(["--base-ref"])).toThrow(/needs a ref/)
    expect(parseArgs(["--base-ref", PROD_SHA]).baseRef).toBe(PROD_SHA)
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown argument/)
  })

  it("reads postgres.mjs exports", () => {
    expect(
      parseExports(
        [
          "export DIRECT_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5555/nabareview_test'",
          "PostgreSQL (native) ready on 127.0.0.1:5555",
          "export NABA_PG_PORT='5555'",
        ].join("\n")
      )
    ).toEqual({
      DIRECT_DATABASE_URL:
        "postgresql://postgres:postgres@127.0.0.1:5555/nabareview_test",
      NABA_PG_PORT: "5555",
    })
  })

  it("gives the heavy steps a CPU budget, build first and nothing oversubscribed", async () => {
    expect(defaultCpuBudget(18)).toBe(13)
    expect(defaultCpuBudget(2)).toBe(4)
    expect(HEAVY_STEP_PRIORITY[0]).toBe("build")
    const weights = heavyStepWeights(13, 4)
    for (const id of HEAVY_STEP_PRIORITY) {
      expect(weights[id], id).toBeGreaterThan(0)
      expect(
        GATE_STEPS.some((step: { id: string }) => step.id === id),
        id
      ).toBe(true)
    }
    expect(weights.unit).toBe(6)

    const settle = () => new Promise((done) => setTimeout(done, 0))
    const budget = new CpuBudget(10)
    const started: string[] = []
    const take = (id: string, weight: number, priority: number) =>
      budget.acquire(weight, priority).then((release) => {
        started.push(id)
        return release
      })
    // Waiting steps start in priority order, whatever order they asked in.
    const releaseFull = await take("full", 10, 9)
    const lint = take("lint", 2, 5)
    const build = take("build", 4, 0)
    await settle()
    expect(started).toEqual(["full"])
    releaseFull()
    const [releaseBuild, releaseLint] = await Promise.all([build, lint])
    expect(started).toEqual(["full", "build", "lint"])
    expect(budget.used).toBe(6)
    releaseBuild()
    releaseLint()
    releaseLint() // releasing twice frees once
    expect(budget.used).toBe(0)

    // Strict order: a small step that would fit still waits behind a
    // waiting build, so small steps cannot hold the build back.
    const releaseUnit = await take("unit", 6, 3)
    const build2 = take("build2", 8, 0)
    const lint2 = take("lint2", 2, 5)
    await settle()
    expect(started.slice(-1)).toEqual(["unit"])
    releaseUnit()
    const [releaseBuild2, releaseLint2] = await Promise.all([build2, lint2])
    expect(started.slice(-2)).toEqual(["build2", "lint2"])
    releaseBuild2()
    releaseLint2()
    expect(budget.used).toBe(0)
    // A step bigger than the whole budget still runs, alone.
    const big = new CpuBudget(3)
    const releaseBig = await big.acquire(8, 0)
    expect(big.used).toBe(8)
    releaseBig()
    expect(big.used).toBe(0)
  })

  it("serves steps that become ready in the same turn in priority order, build first", async () => {
    // When frozen-install passes, typecheck, lint, unit and build all ask
    // for CPU in one turn, in receipt order, while nothing holds the budget.
    const settle = () => new Promise((done) => setTimeout(done, 0))
    const budget = new CpuBudget(6)
    const priority = (id: string) => HEAVY_STEP_PRIORITY.indexOf(id)
    const started: string[] = []
    const releases = new Map<string, () => void>()
    const take = (id: string, weight: number) =>
      budget.acquire(weight, priority(id)).then((release) => {
        started.push(id)
        releases.set(id, release)
        return release
      })
    const lint = take("lint", 2)
    const typecheck = take("typecheck", 2)
    const build = take("build", 4)
    await settle()
    // Build first; typecheck fits beside it; lint waits for a share.
    expect(started).toEqual(["build", "typecheck"])
    expect(budget.used).toBe(6)
    await Promise.all([build, typecheck])
    releases.get("build")!()
    await lint
    expect(started).toEqual(["build", "typecheck", "lint"])
    releases.get("typecheck")!()
    releases.get("lint")!()
    expect(budget.used).toBe(0)
  })

  it("stops steps still waiting for CPU when --fail-fast stops the run", async () => {
    const settle = () => new Promise((done) => setTimeout(done, 0))
    const budget = new CpuBudget(4)
    const run = { failFast: true, stop: false }
    // The build holds the whole budget; e2e waits for it.
    const releaseBuild = await acquireUnlessStopped(run, () =>
      budget.acquire(4, 0)
    )
    expect(releaseBuild).toBeTypeOf("function")
    const e2e = acquireUnlessStopped(run, () => budget.acquire(4, 1))
    await settle()
    expect(budget.used).toBe(4)
    // The build fails: the run stops before its share can start e2e.
    releaseAfter(run, { status: "failed" }, releaseBuild!)
    expect(run.stop).toBe(true)
    expect(await e2e).toBeNull()
    expect(budget.used).toBe(0)
    // A stopped run does not start a step that asks afterwards either.
    expect(
      await acquireUnlessStopped(run, () => budget.acquire(2, 5))
    ).toBeNull()
    expect(budget.used).toBe(0)

    // Passing or skipped steps, or a failure without --fail-fast, hand the
    // share on to the waiting step.
    for (const [failFast, status] of [
      [true, "passed"],
      [true, "skipped"],
      [false, "failed"],
      [false, "not-run"],
    ] as const) {
      const go = { failFast, stop: false }
      const releaseFirst = await acquireUnlessStopped(go, () =>
        budget.acquire(4, 0)
      )
      const second = acquireUnlessStopped(go, () => budget.acquire(4, 1))
      releaseAfter(go, { status }, releaseFirst!)
      expect(go.stop, `${failFast} ${status}`).toBe(false)
      const releaseSecond = await second
      expect(releaseSecond, `${failFast} ${status}`).toBeTypeOf("function")
      expect(budget.used).toBe(4)
      releaseSecond!()
      expect(budget.used).toBe(0)
    }
    // The flag is already set when the share is freed, whatever frees it
    // next; a step that did not run stops the run too.
    for (const status of ["failed", "not-run"]) {
      const stopping = { failFast: true, stop: false }
      const stopWhenReleased: boolean[] = []
      releaseAfter(stopping, { status }, () =>
        stopWhenReleased.push(stopping.stop)
      )
      expect(stopWhenReleased, status).toEqual([true])
    }

    // runStep goes through both, and nothing else sets the stop flag.
    const source = readRepoText("scripts/release/verify-local.mjs")
    expect(source).toContain("await acquireUnlessStopped(run, () =>")
    expect(source).toContain("releaseAfter(run, result, release)")
    expect(source.match(/\.stop = true/g)).toHaveLength(1)
  })

  it("parses the CPU budget", () => {
    expect(parseArgs([]).cpus).toBeNull()
    expect(parseArgs(["--cpus", "6"]).cpus).toBe(6)
    expect(parseArgs([], { NABA_GATE_CPUS: "8" }).cpus).toBe(8)
    for (const bad of ["0", "two", "1.5", ""]) {
      expect(() => parseArgs(["--cpus", bad])).toThrow(/--cpus/)
    }
  })

  it("keeps its run directory out of the folder macOS empties at 03:35", () => {
    const home = "/Users/x"
    // The per-user temp folder dirhelper cleans: not used.
    for (const tmp of [
      "/var/folders/t4/abc/T/",
      "/private/var/folders/t4/abc/T",
    ]) {
      expect(gateRunRoot({}, { tmp, home })).toBe(
        "/Users/x/Library/Caches/naba-verify"
      )
    }
    // A CI runner's own temp folder (TMPDIR=RUNNER_TEMP) is used as is.
    expect(
      gateRunRoot({}, { tmp: "/Users/gh-runner/mac-1/_work/_temp", home })
    ).toBe("/Users/gh-runner/mac-1/_work/_temp")
    expect(gateRunRoot({}, { tmp: "/tmp", home })).toBe("/tmp")
    // An explicit choice wins.
    expect(
      gateRunRoot(
        { NABA_GATE_DIR: "/Volumes/fast/gate" },
        { tmp: "/var/folders/a/b/T", home }
      )
    ).toBe("/Volumes/fast/gate")
  })

  it("preserves old and unknown siblings when a gate starts", () => {
    const fixture = mkdtempSync(join(tmpdir(), "naba-gate-preservation-"))
    try {
      const old = new Date(Date.now() - 30 * 86_400_000)
      const siblings = [
        "naba-verify-paused",
        "naba-verify-unknown",
        "naba-verify-kept-worktree",
        "naba-verify-failed-evidence",
        "unrelated-directory",
      ]
      for (const name of siblings) {
        const directory = join(fixture, name)
        mkdirSync(join(directory, "src"), { recursive: true })
        writeFileSync(join(directory, "src", "checkpoint.txt"), name)
        // Nested work can be fresh while the top-level directory looks old.
        utimesSync(directory, old, old)
      }
      const oldFile = join(fixture, "naba-verify-unknown-file")
      writeFileSync(oldFile, "retained evidence")
      utimesSync(oldFile, old, old)

      // Execute the actual allocation span in main, stopping before any log,
      // Git, PostgreSQL or child-process setup. No copied cleanup algorithm.
      const source = readRepoText("scripts/release/verify-local.mjs")
      const start = source.indexOf("  const runRoot = gateRunRoot(")
      const end = source.indexOf("\n  const worktree = join(runDir,", start)
      assert(start >= 0 && end > start, "gate startup span must be located")
      const startup = source.slice(start, end) + "\nrunDir"
      const context = {
        gateRunRoot,
        process: { env: { NABA_GATE_DIR: fixture } },
        tmpdir: () => fixture,
        homedir: () => fixture,
        mkdirSync,
        mkdtempSync,
        readdirSync,
        statSync,
        rmSync,
        join,
        sha: SHA,
        // Lets the same regression execute the pre-fix startup as a negative
        // control without changing its original seven-day retention value.
        RUN_DIR_RETENTION_DAYS: 7,
      }
      const first = runInNewContext(startup, { ...context })
      const second = runInNewContext(startup, { ...context })
      assert.notEqual(first, second, "new runs need separate owned directories")
      assert(statSync(first).isDirectory() && statSync(second).isDirectory())
      assert.equal(readdirSync(first).length, 0)
      assert.equal(readdirSync(second).length, 0)
      for (const name of siblings) {
        const checkpoint = join(fixture, name, "src", "checkpoint.txt")
        assert(
          existsSync(checkpoint),
          `starting a gate removed sibling ${name}`
        )
        assert.equal(readFileSync(checkpoint, "utf8"), name)
      }
      assert.equal(readFileSync(oldFile, "utf8"), "retained evidence")
    } finally {
      // Remove only this test's freshly owned fixture, never a shared root.
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it("compares whole schema dumps, not a tail of them", () => {
    // The migrated schema dumps to about 500 KB; a 256 KB tail compared
    // only its second half, so a difference early in the dump passed.
    const filler = Array.from(
      { length: 20_000 },
      (_, index) => `create index i${index} on t (c);`
    ).join("\n")
    const scratch = `create table a (id int not null);\n${filler}\n`
    const upgraded = `create table a (id int);\n${filler}\n`
    const tail = outputCollector(256 * 1024)
    const whole = outputCollector(null)
    for (const collector of [tail, whole]) collector.add(scratch)
    const tailUpgraded = outputCollector(256 * 1024)
    const wholeUpgraded = outputCollector(null)
    for (const collector of [tailUpgraded, wholeUpgraded]) {
      collector.add(upgraded)
    }
    expect(scratch.length).toBeGreaterThan(256 * 1024)
    // The old collection could not see the difference...
    expect(normalizeSchemaDump(tail.value)).toEqual(
      normalizeSchemaDump(tailUpgraded.value)
    )
    // ...the dump the gate now compares can.
    expect(normalizeSchemaDump(whole.value)).not.toEqual(
      normalizeSchemaDump(wholeUpgraded.value)
    )
    const source = readRepoText("scripts/release/verify-local.mjs")
    expect(source).toMatch(
      /"pg_dump", "--schema-only"[\s\S]*?\{ dbEnv, stdoutOnly: true \}/
    )
  })

  it("normalises schema dumps as ci.yml does", () => {
    const a =
      "-- dump\n\\restrict abc\ncreate table b();\n\ncreate table a();\n"
    const b = "\\restrict xyz\ncreate table a();\ncreate table b();\n-- other\n"
    expect(normalizeSchemaDump(a)).toEqual(normalizeSchemaDump(b))
    expect(normalizeSchemaDump(a)).toEqual([
      "create table a();",
      "create table b();",
    ])
  })

  it("keeps only the count lines of vitest and Playwright output", () => {
    const vitest = [
      "\u001b[32m✓\u001b[39m tests/a.test.ts (3 tests)",
      " Test Files  1 passed (1)",
      "      Tests  3 passed (3)",
      " Test Files  412 passed (412)",
      "      Tests  2669 passed | 2 skipped (2671)",
    ].join("\n")
    expect(summarizeOutput(vitest)).toEqual([
      "Test Files 412 passed (412)",
      "Tests 2669 passed | 2 skipped (2671)",
    ])
    expect(
      summarizeOutput("  166 passed (4.1m)\n  18 skipped\nnoise\n")
    ).toEqual(["166 passed (4.1m)", "18 skipped"])
    expect(summarizeOutput("")).toEqual([])
  })

  it("adds up the two Playwright runs' counts", () => {
    expect(
      mergePlaywrightSummaries([
        ["461 passed (12.0m)"],
        ["130 passed (8.1m)", "2 failed", "1 flaky"],
      ])
    ).toEqual(["591 passed", "2 failed", "1 flaky"])
    // A skip in either run reaches the receipt, which refuses it.
    const merged = mergePlaywrightSummaries([
      ["461 passed (12.0m)"],
      ["131 passed (8.1m)", "1 skipped"],
    ])
    expect(merged).toEqual(["592 passed", "1 skipped"])
    expect(
      gateProblems(
        allPassed().map((step) =>
          step.id === "e2e" ? { ...step, summary: merged } : step
        )
      )
    ).toEqual(['step "e2e" skipped tests (1 skipped)'])
    expect(mergePlaywrightSummaries([[], []])).toEqual([])
  })

  it("adds up the shards' vitest counts, in vitest's own wording", () => {
    expect(
      mergeVitestSummaries([
        ["Test Files 41 passed (41)", "Tests 356 passed (356)"],
        ["Test Files 40 passed (40)", "Tests 300 passed | 2 skipped (302)"],
        [
          "Test Files 1 failed | 40 passed (41)",
          "Tests 1 failed | 410 passed (411)",
        ],
      ])
    ).toEqual([
      "Test Files 1 failed | 121 passed (122)",
      "Tests 1 failed | 1066 passed | 2 skipped (1069)",
    ])
    // The merged line is what the receipt judges: skips still fail it.
    expect(
      gateProblems(
        allPassed().map((step) =>
          step.id === "integration"
            ? {
                ...step,
                summary: mergeVitestSummaries([
                  ["Tests 10 passed (10)"],
                  ["Tests 9 passed | 1 skipped (10)"],
                ]),
              }
            : step
        )
      )
    ).toEqual([
      'step "integration" skipped tests (Tests 19 passed | 1 skipped (20))',
    ])
    // A shard that reported nothing leaves no count to trust.
    expect(mergeVitestSummaries([["Tests 10 passed (10)"], []])).toEqual([])
    expect(mergeVitestSummaries([])).toEqual([])
  })
})

describe("verify:release receipt", () => {
  it("passes only when every required step passed", () => {
    const receipt = buildLocalReceipt(receiptInput(allPassed()))
    expect(receipt.ok).toBe(true)
    expect(receipt.mode).toBe("worktree")
    expect(receipt.steps.map((step: { id: string }) => step.id)).toEqual(
      GATE_STEPS.map((step: { id: string }) => step.id)
    )
    expect(receipt.steps[0]).toMatchObject({ durationMs: 13, required: true })
    expect(localReceiptFileName(receipt)).toBe(
      `20261010T112000Z-${SHA.slice(0, 12)}.json`
    )
    expect(localReceiptProblems(receipt, { sha: SHA, nodeMajor: 24 })).toEqual(
      []
    )
  })

  it("fills steps that never reported as not-run, and fails", () => {
    const receipt = buildLocalReceipt(receiptInput(allPassed().slice(0, 3)))
    expect(receipt.ok).toBe(false)
    expect(
      receipt.steps.find((step: { id: string }) => step.id === "e2e")
    ).toMatchObject({ status: "not-run" })
  })

  it("requires the secret scan: neither skipped nor failed passes", () => {
    const skip = allPassed().map((step) =>
      step.id === "secret-scan"
        ? { ...step, status: "skipped" as const, note: "gitleaks missing" }
        : step
    )
    expect(buildLocalReceipt(receiptInput(skip)).ok).toBe(false)
    expect(gateProblems(skip)).toEqual(['required step "secret-scan" skipped'])
    const fail = allPassed().map((step) =>
      step.id === "secret-scan" ? { ...step, status: "failed" as const } : step
    )
    expect(buildLocalReceipt(receiptInput(fail)).ok).toBe(false)
    expect(gateProblems(fail)).toEqual(['step "secret-scan" failed'])
  })

  it("refuses an integration step that ran no tests or skipped some", () => {
    const withSummary = (id: string, summary?: string[]) =>
      allPassed().map((step) => (step.id === id ? { ...step, summary } : step))
    // Every integration file describe.skips without RUN_DB_TESTS=true: the
    // run exits 0 having tested nothing.
    expect(
      gateProblems(
        withSummary("integration", [
          "Test Files 143 skipped (143)",
          "Tests 1254 skipped (1254)",
        ])
      )
    ).toEqual(['step "integration" passed but reported no test count'])
    expect(
      gateProblems(withSummary("integration", ["Tests 0 passed (0)"]))
    ).toEqual(['step "integration" passed with 0 tests run'])
    expect(
      gateProblems(
        withSummary("integration", ["Tests 1200 passed | 54 skipped (1254)"])
      )
    ).toEqual([
      'step "integration" skipped tests (Tests 1200 passed | 54 skipped (1254))',
    ])
    expect(gateProblems(withSummary("integration", undefined))).toEqual([
      'step "integration" passed but reported no test count',
    ])
    expect(buildLocalReceipt(receiptInput(withSummary("integration"))).ok).toBe(
      false
    )
    // e2e must run something and skip nothing: Playwright reports skips on
    // a line of their own.
    expect(gateProblems(withSummary("e2e", ["570 passed (19.0m)"]))).toEqual([])
    expect(
      gateProblems(withSummary("e2e", ["570 passed (19.0m)", "2 skipped"]))
    ).toEqual(['step "e2e" skipped tests (2 skipped)'])
    expect(gateProblems(withSummary("e2e", ["0 passed (1.0s)"]))).toEqual([
      'step "e2e" passed with 0 tests run',
    ])
    // A failed step is reported as failed, not for its counts.
    const failed = allPassed().map((step) =>
      step.id === "integration"
        ? { ...step, status: "failed" as const, summary: [] }
        : step
    )
    expect(gateProblems(failed)).toEqual(['step "integration" failed'])
  })

  it("rejects duplicate and unknown steps", () => {
    expect(
      gateProblems([
        ...allPassed(),
        { id: "unit", status: "passed", durationMs: 1 },
      ])
    ).toContain('step "unit" appears twice')
    expect(
      gateProblems([
        ...allPassed(),
        { id: "deploy", status: "passed", durationMs: 1 },
      ])
    ).toContain('unknown step "deploy"')
  })

  it("refuses to write anything redaction would touch", () => {
    const leaky = allPassed().map((step) =>
      step.id === "unit"
        ? { ...step, note: "postgres://admin:pw@db.example.test/x" }
        : step
    )
    expect(() => buildLocalReceipt(receiptInput(leaky))).toThrow(
      /secret-like values at \$\.steps\[3\]\.note/
    )
  })

  it("refuses a base that tests no upgrade, or is not the last promotion", () => {
    const selfBase = buildLocalReceipt({
      ...receiptInput(allPassed()),
      base: { ref: "origin/main", sha: SHA, mergeBase: SHA, source: "default" },
    })
    expect(localReceiptProblems(selfBase, { sha: SHA, nodeMajor: 24 })).toEqual(
      [expect.stringMatching(/merge base is the commit itself.*--base-ref/)]
    )
    const receipt = buildLocalReceipt(receiptInput(allPassed()))
    expect(
      localReceiptProblems(receipt, {
        sha: SHA,
        nodeMajor: 24,
        previousSha: PROD_SHA,
      })
    ).toEqual([])
    const other = "1111111111111111111111111111111111111111"
    expect(
      localReceiptProblems(receipt, {
        sha: SHA,
        nodeMajor: 24,
        previousSha: other,
      })
    ).toEqual([
      `the local gate's base is ${PROD_SHA.slice(0, 12)}, not ${other.slice(0, 12)}, the release production serves according to the receipts`,
    ])
    expect(
      localReceiptProblems(
        { ...receipt, base: undefined },
        { sha: SHA, nodeMajor: 24 }
      )
    ).toContain("the local receipt records no base commit")
  })

  it("refuses a receipt from a checkout with edited gate sources", () => {
    const changed = gateSourceChanges([
      " M scripts/release/local-receipt.mjs",
      "?? scripts/ci/new.mjs",
      " M package.json",
      " M app/page.tsx",
      "R  lib/a.ts -> lib/domain/redaction.ts",
      " M scripts/release-notes.md",
    ])
    expect(changed).toEqual([
      "lib/domain/redaction.ts",
      "package.json",
      "scripts/ci/new.mjs",
      "scripts/release/local-receipt.mjs",
    ])
    expect(gateSourceChanges([" M app/page.tsx", "?? notes.txt"])).toEqual([])
    const dirty = buildLocalReceipt({
      ...receiptInput(allPassed()),
      gateSource: { clean: false, changed },
    })
    expect(dirty.ok).toBe(true)
    expect(localReceiptProblems(dirty, { sha: SHA, nodeMajor: 24 })).toEqual([
      `the local gate ran with uncommitted changes to its own sources (${changed.join(", ")})`,
    ])
  })

  it("finds the commit the newest committed promotion receipt shipped", () => {
    expect(latestPromotedRelease([])).toBeNull()
    expect(
      latestPromotedRelease([
        { name: "docs/release/receipts/README.md", content: "# x" },
        {
          name: "docs/release/receipts/20261011T090000Z-fedcba987654.json",
          content: JSON.stringify({ sha: PROD_SHA }),
        },
        {
          name: "docs/release/receipts/20261012T090000Z-0123456789ab.local.json",
          content: JSON.stringify({ sha: SHA }),
        },
        {
          name: "docs/release/receipts/20261001T090000Z-0123456789ab.json",
          content: JSON.stringify({ sha: SHA }),
        },
      ])
    ).toEqual({ file: "20261011T090000Z-fedcba987654.json", sha: PROD_SHA })
    expect(() =>
      latestPromotedRelease([
        { name: "20261011T090000Z-fedcba987654.json", content: "{" },
      ])
    ).toThrow(/no readable commit SHA/)

    // After a rollback the base is what production serves again: the
    // target, once the rollback's probe confirmed it; never the release it
    // rolled away from. An unconfirmed one changes nothing.
    const promotions = [
      {
        name: "docs/release/receipts/20261001T090000Z-0123456789ab.json",
        content: JSON.stringify({ sha: SHA }),
      },
      {
        name: "docs/release/receipts/20261011T090000Z-fedcba987654.json",
        content: JSON.stringify({ sha: PROD_SHA }),
      },
    ]
    const rollback = (time: string, served: string) => ({
      name: `docs/release/receipts/${time}-0123456789ab.rollback.json`,
      content: JSON.stringify({
        kind: "naba-rollback",
        sha: SHA,
        to: { receipt: "20261001T090000Z-0123456789ab.json", sha: SHA },
        productionProbe: { ok: served === SHA, servedSha: served },
      }),
    })
    expect(
      latestPromotedRelease([
        ...promotions,
        rollback("20261012T090000Z", PROD_SHA),
      ])
    ).toEqual({ file: "20261011T090000Z-fedcba987654.json", sha: PROD_SHA })
    expect(
      latestPromotedRelease([...promotions, rollback("20261012T090000Z", SHA)])
    ).toEqual({ file: "20261001T090000Z-0123456789ab.json", sha: SHA })
    expect(() =>
      latestPromotedRelease([
        ...promotions,
        { name: "20261012T090000Z-0123456789ab.rollback.json", content: "{" },
      ])
    ).toThrow(/names no earlier promotion receipt/)
  })

  it("writes into a gitignored directory", () => {
    const ignored = execFileSync(
      "git",
      ["check-ignore", "-q", "--no-index", `${LOCAL_RECEIPTS_DIR}/x.json`],
      { cwd: repoRoot, stdio: "pipe" }
    )
    expect(ignored).toBeDefined()
  })
})
