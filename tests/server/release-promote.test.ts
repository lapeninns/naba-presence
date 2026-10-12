import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  GATE_STEPS,
  LOCAL_RECEIPT_KIND,
  LOCAL_RECEIPT_VERSION,
} from "../../scripts/release/local-receipt.mjs"
import {
  buildReceipt,
  checkCandidate,
  localReceiptCopyName,
  migrationReceipt,
  parseDeployOutput,
  parseEnvNames,
  readLocalReceipt,
  receiptFileName,
  secretLikePaths,
  worktreeIssues,
} from "../../scripts/release/promote.mjs"

const SHA = "0123456789abcdef0123456789abcdef01234567"
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98"

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

type Step = { id: string; status: string; required?: boolean }

const passingSteps = (): Step[] =>
  GATE_STEPS.map((step: { id: string; required: boolean }) => ({
    id: step.id,
    required: step.required,
    status: "passed",
    durationMs: 1000,
  }))

const localContent = (overrides: Record<string, unknown> = {}) => ({
  kind: LOCAL_RECEIPT_KIND,
  version: LOCAL_RECEIPT_VERSION,
  sha: SHA,
  mode: "worktree",
  base: {
    ref: OTHER_SHA,
    sha: OTHER_SHA,
    mergeBase: OTHER_SHA,
    source: "promotion-receipt",
  },
  gateSource: { clean: true, changed: [] },
  toolchain: { node: "v24.18.0", pnpm: "10.34.5" },
  options: { skip: [], failFast: false },
  ok: true,
  steps: passingSteps(),
  startedAt: "2026-10-10T11:00:00.000Z",
  finishedAt: "2026-10-10T11:20:00.000Z",
  ...overrides,
})

const local = (overrides: Record<string, unknown> = {}) =>
  readLocalReceipt(
    "/tmp/receipts/20261010T112000Z-0123456789ab.json",
    Buffer.from(JSON.stringify(localContent(overrides)))
  )

const withStep = (id: string, status: string) =>
  passingSteps().map((step) => (step.id === id ? { ...step, status } : step))

const candidate = (overrides: Partial<Parameters<typeof checkCandidate>[0]>) =>
  checkCandidate({
    sha: SHA,
    worktreeClean: true,
    headIsOriginMain: true,
    schemaStatus: "current",
    localReceipt: local(),
    nodeMajor: 24,
    ...overrides,
  })

describe("release:promote checkCandidate", () => {
  it("accepts a clean origin/main commit with a passing local gate", () => {
    const receipt = local()
    const result = candidate({ localReceipt: receipt })
    expect(result).toMatchObject({ ok: true, problems: [] })
    expect(result.evidence).toEqual({
      localGate: {
        file: "20261010T112000Z-0123456789ab.json",
        sha256: receipt.sha256,
        finishedAt: "2026-10-10T11:20:00.000Z",
        base: {
          ref: OTHER_SHA,
          sha: OTHER_SHA,
          mergeBase: OTHER_SHA,
          source: "promotion-receipt",
        },
        steps: GATE_STEPS.map((step: { id: string }) => ({
          id: step.id,
          status: "passed",
        })),
      },
    })
  })

  it("requires the local gate's base to be the last promoted commit", () => {
    expect(candidate({ previousSha: OTHER_SHA }).ok).toBe(true)
    const stale = candidate({ previousSha: "1".repeat(40) })
    expect(stale.ok).toBe(false)
    expect(stale.problems).toEqual([
      expect.stringMatching(
        /^local gate: the local gate's base is fedcba987654, not 111111111111/
      ),
    ])
    const self = candidate({
      localReceipt: local({
        base: { ref: "origin/main", sha: SHA, mergeBase: SHA },
      }),
    })
    expect(self.ok).toBe(false)
    expect(self.problems[0]).toMatch(/merge base is the commit itself/)
  })

  it("refuses a local receipt written with edited gate sources", () => {
    const result = candidate({
      localReceipt: local({
        gateSource: { clean: false, changed: ["scripts/release/promote.mjs"] },
      }),
    })
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      "local gate: the local gate ran with uncommitted changes to its own sources (scripts/release/promote.mjs)",
    ])
  })

  it("pins the local receipt by the sha256 of its exact bytes", () => {
    const bytes = Buffer.from(JSON.stringify(localContent()))
    expect(readLocalReceipt("a/b.json", bytes)).toMatchObject({
      file: "b.json",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })
    expect(readLocalReceipt("x.json", Buffer.from("{not json")).content).toBe(
      null
    )
  })

  it("refuses a dirty worktree", () => {
    const result = candidate({ worktreeClean: false })
    expect(result.ok).toBe(false)
    expect(result.problems).toContain("the worktree is not clean")
  })

  it("refuses a HEAD that is not origin/main", () => {
    const result = candidate({ headIsOriginMain: false })
    expect(result.ok).toBe(false)
    expect(result.problems).toContain("HEAD is not origin/main")
  })

  it("refuses an abbreviated or missing SHA", () => {
    expect(candidate({ sha: SHA.slice(0, 12) }).ok).toBe(false)
    expect(candidate({ sha: "" }).ok).toBe(false)
  })

  it("refuses pending migrations, and an unconfirmed schema", () => {
    expect(candidate({ schemaStatus: "pending" }).problems).toContain(
      "the production database has pending migrations"
    )
    expect(candidate({ schemaStatus: "unknown" }).ok).toBe(false)
  })

  it("refuses without a local receipt, or with an unreadable one", () => {
    const missing = candidate({ localReceipt: null })
    expect(missing.ok).toBe(false)
    expect(missing.evidence).toBeNull()
    expect(missing.problems[0]).toMatch(/run pnpm verify:release/)
    const garbled = candidate({
      localReceipt: readLocalReceipt("x.json", Buffer.from("[]")),
    })
    expect(garbled.ok).toBe(false)
  })

  it("refuses a local receipt for another commit", () => {
    const result = candidate({ localReceipt: local({ sha: OTHER_SHA }) })
    expect(result.ok).toBe(false)
    expect(result.problems).toContain(
      "local gate: the local receipt is for fedcba987654, not 0123456789ab"
    )
  })

  it("refuses a failed, skipped or not-run required step", () => {
    for (const status of ["failed", "skipped", "not-run"]) {
      const result = candidate({
        localReceipt: local({ steps: withStep("e2e", status) }),
      })
      expect(result.ok).toBe(false)
      expect(result.evidence).toBeNull()
    }
    expect(
      candidate({ localReceipt: local({ steps: withStep("unit", "failed") }) })
        .problems
    ).toContain('local gate: step "unit" failed')
  })

  it("re-judges the steps instead of trusting the ok flag", () => {
    const result = candidate({
      localReceipt: local({ ok: true, steps: withStep("audit", "failed") }),
    })
    expect(result.ok).toBe(false)
    const missingStep = candidate({
      localReceipt: local({
        steps: passingSteps().filter((step) => step.id !== "integration"),
      }),
    })
    expect(missingStep.problems).toContain(
      'local gate: step "integration" is missing'
    )
    expect(candidate({ localReceipt: local({ ok: false }) }).ok).toBe(false)
  })

  it("accepts a skipped secret scan only, never a failed one", () => {
    expect(
      candidate({
        localReceipt: local({ steps: withStep("secret-scan", "skipped") }),
      }).ok
    ).toBe(true)
    expect(
      candidate({
        localReceipt: local({ steps: withStep("secret-scan", "failed") }),
      }).ok
    ).toBe(false)
  })

  it("refuses a run with requested skips, another Node major or another mode", () => {
    expect(
      candidate({
        localReceipt: local({
          options: { skip: ["secret-scan"], failFast: false },
        }),
      }).ok
    ).toBe(false)
    expect(
      candidate({ localReceipt: local({ toolchain: { node: "v22.11.0" } }) }).ok
    ).toBe(false)
    expect(candidate({ localReceipt: local({ mode: "in-place" }) }).ok).toBe(
      false
    )
    expect(candidate({ localReceipt: local({ kind: "other" }) }).ok).toBe(false)
  })

  it("never lets a passing local gate excuse the worktree, branch or schema", () => {
    expect(candidate({ worktreeClean: false }).evidence).toBeNull()
    expect(candidate({ headIsOriginMain: false }).ok).toBe(false)
    expect(candidate({ schemaStatus: "pending" }).ok).toBe(false)
  })
})

describe("release:promote receipt", () => {
  const base = {
    sha: SHA,
    deployment: { id: "dpl_abc123", url: "https://naba-abc.vercel.app" },
    evidence: {
      localGate: {
        file: "20261010T112000Z-0123456789ab.json",
        sha256: sha256("receipt"),
        finishedAt: "2026-10-10T11:20:00.000Z",
        base: { ref: OTHER_SHA, sha: OTHER_SHA, mergeBase: OTHER_SHA },
        steps: [{ id: "unit", status: "passed" }],
      },
    },
    migrations: migrationReceipt([
      { name: "0002_b.sql", content: "select 2;" },
      { name: "0001_a.sql", content: "select 1;" },
      { name: "README.md", content: "not a migration" },
    ]),
    configNames: ["CRON_SECRET", "DATABASE_URL", "CRON_SECRET"],
    operator: "release-operator",
    timestamp: "2026-10-10T12:00:00.000Z",
  }

  it("records build, migration and configuration sections", () => {
    const receipt = buildReceipt(base)
    expect(receipt).toEqual({
      sha: SHA,
      deploymentId: "dpl_abc123",
      url: "https://naba-abc.vercel.app",
      localGate: {
        ...base.evidence.localGate,
        copy: `20261010T120000Z-${SHA.slice(0, 12)}.local.json`,
      },
      migrations: [
        { version: "0001_a", sha256: sha256("select 1;") },
        { version: "0002_b", sha256: sha256("select 2;") },
      ],
      configNames: ["CRON_SECRET", "DATABASE_URL"],
      operator: "release-operator",
      timestamp: "2026-10-10T12:00:00.000Z",
    })
    expect(receipt).not.toHaveProperty("ciRunUrl")
    expect(receipt).not.toHaveProperty("exceptionRef")
  })

  it("hashes migration content, so an edited file changes the receipt", () => {
    const [before] = migrationReceipt([
      { name: "0001_a.sql", content: "select 1;" },
    ])
    const [after] = migrationReceipt([
      { name: "0001_a.sql", content: "select 2;" },
    ])
    expect(before.version).toBe(after.version)
    expect(before.sha256).not.toBe(after.sha256)
  })

  it("contains no values matching secret patterns", () => {
    expect(secretLikePaths(buildReceipt(base))).toEqual([])
  })

  it("refuses a configuration value in place of a name", () => {
    expect(() =>
      buildReceipt({
        ...base,
        configNames: ["DATABASE_URL", "postgres://admin:pw@db.test:5432/x"],
      })
    ).toThrow(/environment variable names/)
    expect(() =>
      buildReceipt({ ...base, configNames: ["CRON_SECRET=abc"] })
    ).toThrow(/environment variable names/)
  })

  it("refuses to write anything redaction would touch", () => {
    expect(() =>
      buildReceipt({
        ...base,
        deployment: {
          id: "dpl_1",
          url: "https://naba.vercel.app/?token=abc",
        },
      })
    ).toThrow(/secret-like values at \$\.url/)
    expect(() =>
      buildReceipt({
        ...base,
        operator: "Bearer abcdefghijklmnop",
      })
    ).toThrow(/\$\.operator/)
    expect(
      secretLikePaths({ nested: [{ jwt: "eyJhbGciOiJIUzI1.eyJzdWIi.c2ln" }] })
    ).toEqual(["$.nested[0].jwt"])
  })

  it("names the file by time and commit", () => {
    const receipt = buildReceipt(base)
    expect(receiptFileName(receipt)).toBe(
      `20261010T120000Z-${SHA.slice(0, 12)}.json`
    )
    expect(localReceiptCopyName(receipt)).toBe(receipt.localGate.copy)
  })
})

describe("release:promote CLI parsing", () => {
  it("reads the deployment id and url from vercel deploy --format json", () => {
    expect(
      parseDeployOutput(
        JSON.stringify({ deployment: { id: "dpl_1", url: "naba.vercel.app" } })
      )
    ).toEqual({ id: "dpl_1", url: "https://naba.vercel.app" })
    expect(
      parseDeployOutput(
        JSON.stringify({ id: "dpl_2", url: "https://n.vercel.app" })
      )
    ).toEqual({ id: "dpl_2", url: "https://n.vercel.app" })
    expect(() => parseDeployOutput("{}")).toThrow(/deployment id and url/)
  })

  it("keeps only names from vercel env ls, dropping any values", () => {
    const names = parseEnvNames(
      JSON.stringify({
        envs: [
          { key: "DATABASE_URL", value: "postgres://u:p@h/db" },
          { key: "CRON_SECRET", value: "s3cret-value" },
          { key: "CRON_SECRET", target: ["production"] },
        ],
      })
    )
    expect(names).toEqual(["CRON_SECRET", "DATABASE_URL"])
    expect(parseEnvNames("[]")).toEqual([])
  })

  it("treats changes, untracked files and ignored env files as unclean", () => {
    expect(worktreeIssues("", ["node_modules/", ".next/", ".vercel/"])).toEqual(
      []
    )
    expect(
      worktreeIssues(" M lib/a.ts\n?? scratch.txt\n", [
        ".env.local",
        ".dev.vars",
      ])
    ).toEqual([
      "changed: lib/a.ts",
      "changed: scratch.txt",
      "ignored env file present: .env.local",
      "ignored env file present: .dev.vars",
    ])
  })

  it("is wired as pnpm release:promote and pnpm verify:release", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8")
    )
    expect(pkg.scripts["release:promote"]).toBe(
      "node scripts/release/promote.mjs"
    )
    expect(pkg.scripts["verify:release"]).toBe(
      "node scripts/release/verify-local.mjs"
    )
  })
})
