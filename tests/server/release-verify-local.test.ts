import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  GATE_STEPS,
  LOCAL_RECEIPTS_DIR,
  buildLocalReceipt,
  gateProblems,
  localReceiptFileName,
  localReceiptProblems,
} from "../../scripts/release/local-receipt.mjs"
import {
  CI_PLACEHOLDER_ENV,
  STRIPPED_ENV,
  childEnv,
  normalizeSchemaDump,
  parseArgs,
  parseExports,
  summarizeOutput,
} from "../../scripts/release/verify-local.mjs"
import { readRepoText } from "../helpers/repo-text"

const SHA = "0123456789abcdef0123456789abcdef01234567"
const repoRoot = fileURLToPath(new URL("../../", import.meta.url))

type StepResult = {
  id: string
  status: "passed" | "failed" | "skipped" | "not-run"
  durationMs: number
  summary?: string[]
  note?: string
  exitCode?: number | null
}

const allPassed = (): StepResult[] =>
  GATE_STEPS.map((step: { id: string }) => ({
    id: step.id,
    status: "passed" as const,
    durationMs: 12.6,
  }))

const receiptInput = (steps: StepResult[]) => ({
  sha: SHA,
  base: { ref: "origin/main", sha: SHA, mergeBase: SHA },
  toolchain: { node: "v24.18.0", pnpm: "10.34.5", postgres: null },
  steps,
  options: { skip: [], failFast: false },
  startedAt: "2026-10-10T11:00:00.000Z",
  finishedAt: "2026-10-10T11:20:00.123Z",
})

describe("verify:release steps", () => {
  it("covers every CI job's checks and the nightly audit", () => {
    const ids = GATE_STEPS.map((step: { id: string }) => step.id)
    expect(ids).toEqual([
      "frozen-install",
      "typecheck",
      "lint",
      "unit",
      "build",
      "migration-policy",
      "migrate-fresh",
      "migrate-upgrade",
      "migrate-concurrent",
      "integration",
      "e2e",
      "audit",
      "secret-scan",
    ])
    // Only the secret scan may be skipped (gitleaks not installed).
    expect(
      GATE_STEPS.filter((step: { required: boolean }) => !step.required).map(
        (step: { id: string }) => step.id
      )
    ).toEqual(["secret-scan"])
    const ci = readRepoText(".github/workflows/ci.yml")
    for (const command of [
      "pnpm typecheck",
      "pnpm lint",
      "pnpm build",
      "node scripts/ci/migration-policy.mjs",
      "DB_MIGRATE_EXPECT_NOOP=1 pnpm db:migrate",
      "pnpm db:runtime-role",
      "pnpm test:integration",
      "pnpm test:e2e",
      "gitleaks",
    ]) {
      expect(ci).toContain(command)
    }
    expect(readRepoText(".github/workflows/nightly.yml")).toContain(
      "pnpm audit --prod --audit-level high"
    )
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

  it("strips inherited database and CI variables and adds the placeholders", () => {
    const env = childEnv({
      PATH: "/usr/bin",
      HOME: "/home/x",
      DATABASE_URL: "postgresql://u:p@127.0.0.1:54322/postgres",
      DATABASE_SESSION_URL: "postgresql://u:p@127.0.0.1:54322/postgres",
      DIRECT_DATABASE_URL: "postgresql://u:p@db.example.test/postgres",
      ALLOW_REMOTE_TEST_DB: "1",
      GITHUB_ENV: "/tmp/env",
      CI: "true",
      NEXTAUTH_SECRET: "real-secret-from-shell",
      UNSET: undefined,
    })
    for (const name of STRIPPED_ENV) expect(env).not.toHaveProperty(name)
    expect(env).toMatchObject({
      PATH: "/usr/bin",
      HOME: "/home/x",
      ...CI_PLACEHOLDER_ENV,
      LC_ALL: "en_US.UTF-8",
      LANG: "en_US.UTF-8",
    })
    expect(env).not.toHaveProperty("UNSET")
  })

  it("parses arguments and rejects unknown steps", () => {
    expect(parseArgs([])).toMatchObject({
      skip: [],
      failFast: false,
      baseRef: "origin/main",
      receiptsDir: null,
      keepWorktree: false,
    })
    expect(
      parseArgs(["--skip", "e2e,audit", "--skip", "e2e", "--fail-fast"])
    ).toMatchObject({ skip: ["e2e", "audit"], failFast: true })
    expect(() => parseArgs(["--skip", "deploy"])).toThrow(/Unknown step/)
    expect(() => parseArgs(["--base-ref"])).toThrow(/needs a ref/)
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

  it("lets the secret scan skip but not fail", () => {
    const skip = allPassed().map((step) =>
      step.id === "secret-scan"
        ? { ...step, status: "skipped" as const, note: "gitleaks missing" }
        : step
    )
    expect(buildLocalReceipt(receiptInput(skip)).ok).toBe(true)
    const fail = allPassed().map((step) =>
      step.id === "secret-scan" ? { ...step, status: "failed" as const } : step
    )
    expect(buildLocalReceipt(receiptInput(fail)).ok).toBe(false)
    expect(gateProblems(fail)).toEqual(['step "secret-scan" failed'])
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

  it("writes into a gitignored directory", () => {
    const ignored = execFileSync(
      "git",
      ["check-ignore", "-q", "--no-index", `${LOCAL_RECEIPTS_DIR}/x.json`],
      { cwd: repoRoot, stdio: "pipe" }
    )
    expect(ignored).toBeDefined()
  })
})
