import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  REQUIRED_CHECKS,
  buildReceipt,
  checkCandidate,
  isExceptionReference,
  migrationReceipt,
  parseDeployOutput,
  parseEnvNames,
  receiptFileName,
  secretLikePaths,
  worktreeIssues,
} from "../../scripts/release/promote.mjs"

const SHA = "0123456789abcdef0123456789abcdef01234567"
const CI_URL = "https://github.com/lapeninns/naba-presence/actions/runs/1/job/2"

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

type Run = {
  id?: number
  name: string
  status: string
  conclusion: string | null
  html_url?: string | null
}

const green = (): Run[] =>
  REQUIRED_CHECKS.map((name: string, index: number) => ({
    id: 10 + index,
    name,
    status: "completed",
    conclusion: "success",
    html_url:
      name === "CI result" ? CI_URL : `https://example.test/check/${index}`,
  }))

const candidate = (overrides: Partial<Parameters<typeof checkCandidate>[0]>) =>
  checkCandidate({
    sha: SHA,
    checkRuns: green(),
    worktreeClean: true,
    headIsOriginMain: true,
    schemaStatus: "current",
    exception: null,
    ...overrides,
  })

const withCheck = (name: string, patch: Partial<Run>): Run[] =>
  green().map((run) => (run.name === name ? { ...run, ...patch } : run))

describe("release:promote checkCandidate", () => {
  it("accepts a green, clean origin/main commit on a current schema", () => {
    const result = candidate({})
    expect(result).toMatchObject({
      ok: true,
      problems: [],
      evidence: { ciRunUrl: CI_URL },
    })
    expect(result.checks).toEqual(
      REQUIRED_CHECKS.map((name: string) => ({
        name,
        status: "completed",
        conclusion: "success",
      }))
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

  it("refuses a failed CI result", () => {
    const result = candidate({
      checkRuns: withCheck("CI result", { conclusion: "failure" }),
    })
    expect(result.ok).toBe(false)
    expect(result.problems).toContain('check "CI result" concluded failure')
  })

  it("refuses a missing CI result", () => {
    const result = candidate({
      checkRuns: green().filter((run) => run.name !== "CI result"),
    })
    expect(result.ok).toBe(false)
    expect(result.problems).toContain(
      'check "CI result" has not run on this commit'
    )
  })

  it("refuses a pending CI result", () => {
    const result = candidate({
      checkRuns: withCheck("CI result", {
        status: "in_progress",
        conclusion: null,
      }),
    })
    expect(result.ok).toBe(false)
    expect(result.problems).toContain(
      'check "CI result" is in_progress, not completed'
    )
  })

  it("refuses a skipped or neutral CI result", () => {
    for (const conclusion of ["skipped", "neutral", "cancelled"]) {
      expect(
        candidate({ checkRuns: withCheck("CI result", { conclusion }) }).ok
      ).toBe(false)
    }
  })

  it("refuses a failed CodeQL analysis", () => {
    for (const name of [
      "Analyze (javascript-typescript)",
      "Analyze (actions)",
    ]) {
      const result = candidate({
        checkRuns: withCheck(name, { conclusion: "failure" }),
      })
      expect(result.ok).toBe(false)
      expect(result.problems).toContain(`check "${name}" concluded failure`)
    }
  })

  it("judges only the latest attempt of a re-run check", () => {
    const rerunGreen = [
      ...green(),
      { id: 1, name: "CI result", status: "completed", conclusion: "failure" },
    ]
    expect(candidate({ checkRuns: rerunGreen }).ok).toBe(true)
    const rerunRed = [
      ...green(),
      {
        id: 99,
        name: "CI result",
        status: "completed",
        conclusion: "failure",
      },
    ]
    expect(candidate({ checkRuns: rerunRed }).ok).toBe(false)
  })

  it("accepts the exception path only with a reference", () => {
    const redChecks = withCheck("CI result", { conclusion: "failure" })
    const accepted = candidate({
      checkRuns: redChecks,
      exception: { ref: "docs/release/ledger.md#CI-01" },
    })
    expect(accepted).toMatchObject({
      ok: true,
      evidence: { exceptionRef: "docs/release/ledger.md#CI-01" },
    })
    expect(
      accepted.checks.find(
        (check: { name: string }) => check.name === "CI result"
      )
    ).toMatchObject({ conclusion: "failure" })

    for (const ref of ["", "  ", "x", "two words"]) {
      const refused = candidate({ checkRuns: redChecks, exception: { ref } })
      expect(refused.ok).toBe(false)
      expect(refused.problems).toContain(
        "--exception needs a reference to where the exception is recorded"
      )
    }
  })

  it("never lets the exception excuse the worktree, branch or schema", () => {
    const exception = { ref: "D-36" }
    const red = withCheck("CI result", { conclusion: "failure" })
    expect(
      candidate({ checkRuns: red, exception, worktreeClean: false }).ok
    ).toBe(false)
    expect(
      candidate({ checkRuns: red, exception, headIsOriginMain: false }).ok
    ).toBe(false)
    expect(
      candidate({ checkRuns: red, exception, schemaStatus: "pending" }).ok
    ).toBe(false)
  })

  it("records CI evidence, not the exception, when the checks are green", () => {
    expect(candidate({ exception: { ref: "D-36" } }).evidence).toEqual({
      ciRunUrl: CI_URL,
    })
  })

  it("rejects an exception reference that carries a credential", () => {
    expect(isExceptionReference("https://x.test/?token=abc")).toBe(false)
    expect(isExceptionReference("postgres://admin:pw@db.test/x")).toBe(false)
    expect(isExceptionReference("https://github.com/o/r/issues/1")).toBe(true)
  })
})

describe("release:promote receipt", () => {
  const base = {
    sha: SHA,
    deployment: { id: "dpl_abc123", url: "https://naba-abc.vercel.app" },
    evidence: { ciRunUrl: CI_URL },
    checks: [{ name: "CI result", status: "completed", conclusion: "success" }],
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
      ciRunUrl: CI_URL,
      checks: base.checks,
      migrations: [
        { version: "0001_a", sha256: sha256("select 1;") },
        { version: "0002_b", sha256: sha256("select 2;") },
      ],
      configNames: ["CRON_SECRET", "DATABASE_URL"],
      operator: "release-operator",
      timestamp: "2026-10-10T12:00:00.000Z",
    })
    expect(receipt).not.toHaveProperty("exceptionRef")
  })

  it("records the exception reference in place of a CI run", () => {
    const receipt = buildReceipt({
      ...base,
      evidence: { exceptionRef: "docs/release/ledger.md#CI-01" },
    })
    expect(receipt).toHaveProperty(
      "exceptionRef",
      "docs/release/ledger.md#CI-01"
    )
    expect(receipt).not.toHaveProperty("ciRunUrl")
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
    expect(receiptFileName(buildReceipt(base))).toBe(
      `20261010T120000Z-${SHA.slice(0, 12)}.json`
    )
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

  it("is wired as pnpm release:promote and requires the CodeQL job names", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8")
    )
    expect(pkg.scripts["release:promote"]).toBe(
      "node scripts/release/promote.mjs"
    )
    const ci = readFileSync(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8"
    )
    expect(ci).toMatch(/name: CI result/)
    const codeql = readFileSync(
      new URL("../../.github/workflows/codeql.yml", import.meta.url),
      "utf8"
    )
    expect(codeql).toMatch(/name: Analyze \(\$\{\{ matrix\.language \}\}\)/)
    expect(codeql).toMatch(/language: \[javascript-typescript, actions\]/)
  })
})
