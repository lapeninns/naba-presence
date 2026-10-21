import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"

import {
  GATE_STEPS,
  LOCAL_RECEIPT_KIND,
  LOCAL_RECEIPT_VERSION,
} from "../../scripts/release/local-receipt.mjs"
import {
  buildReceipt,
  checkCandidate,
  deployArgs,
  localReceiptCopyName,
  migrationReceipt,
  parseDeployOutput,
  parseEnvNames,
  PROBE_ATTEMPTS,
  PROBE_TIMEOUT_EXIT,
  PRODUCTION_MISMATCH_EXIT,
  PRODUCTION_PROBE_ATTEMPTS,
  probeArgs,
  probeResultFromSpawn,
  productionProbeArgs,
  productionProbeReport,
  promoteArgs,
  readLocalReceipt,
  receiptFileName,
  resolveProductionUrl,
  secretLikePaths,
  stagedPromotion,
  verifyProduction,
  worktreeIssues,
} from "../../scripts/release/promote.mjs"

const SHA = "0123456789abcdef0123456789abcdef01234567"
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98"

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

type Step = { id: string; status: string; required?: boolean }

const TEST_SUMMARIES: Record<string, string[]> = {
  integration: ["Test Files 143 passed (143)", "Tests 1254 passed (1254)"],
  e2e: ["572 passed (19.1m)"],
}

const passingSteps = (): Step[] =>
  GATE_STEPS.map((step: { id: string; required: boolean }) => ({
    id: step.id,
    required: step.required,
    status: "passed",
    durationMs: 1000,
    ...(TEST_SUMMARIES[step.id] ? { summary: TEST_SUMMARIES[step.id] } : {}),
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

  it("refuses a receipt whose integration step ran no tests", () => {
    const steps = passingSteps().map((step) =>
      step.id === "integration"
        ? { ...step, summary: ["Tests 1254 skipped (1254)"] }
        : step
    )
    expect(candidate({ localReceipt: local({ steps }) }).problems).toEqual([
      'local gate: step "integration" passed but reported no test count',
    ])
  })

  it("refuses a skipped or failed secret scan", () => {
    expect(
      candidate({
        localReceipt: local({ steps: withStep("secret-scan", "skipped") }),
      }).problems
    ).toEqual(['local gate: required step "secret-scan" skipped'])
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

describe("staged promotion (W7-2): deploy, probe, then promote", () => {
  const STAGED = {
    id: "dpl_staged",
    url: "https://naba-presence-abc123.vercel.app",
  }

  // The Vercel CLI and the probe, mocked: each call is recorded in order.
  function mockCli(probeExitCodes: number[]) {
    const calls: string[] = []
    const exits = [...probeExitCodes]
    return {
      calls,
      deploy: vi.fn(() => {
        calls.push(`vercel ${deployArgs(SHA).join(" ")}`)
        return STAGED
      }),
      probe: vi.fn((url: string) => {
        calls.push(`probe ${probeArgs(url, SHA).join(" ")}`)
        return exits.shift() ?? 2
      }),
      promote: vi.fn((id: string) => {
        calls.push(`vercel ${promoteArgs(id).join(" ")}`)
      }),
      sleep: vi.fn(async () => {}),
    }
  }

  it("deploys a production build without assigning the production domains", () => {
    const args = deployArgs(SHA)
    expect(args.slice(0, 3)).toEqual(["deploy", "--prod", "--skip-domain"])
    expect(args).toEqual(
      expect.arrayContaining([
        `NABA_RELEASE_SHA=${SHA}`,
        `releaseSha=${SHA}`,
        "--format",
      ])
    )
    expect(promoteArgs("dpl_x")).toEqual([
      "promote",
      "dpl_x",
      "--yes",
      "--timeout",
      "5m",
    ])
    expect(probeArgs(STAGED.url, SHA)).toEqual([
      "--url",
      STAGED.url,
      "--expect-sha",
      SHA,
    ])
  })

  it("promotes only after the probe passed against the staged deployment", async () => {
    const cli = mockCli([0])
    const outcome = await stagedPromotion(cli)
    expect(outcome).toEqual({
      promoted: true,
      deployment: STAGED,
      probeExitCode: 0,
    })
    expect(cli.calls).toEqual([
      `vercel ${deployArgs(SHA).join(" ")}`,
      `probe --url ${STAGED.url} --expect-sha ${SHA}`,
      "vercel promote dpl_staged --yes --timeout 5m",
    ])
  })

  it("retries a cold deployment before giving up", async () => {
    const cli = mockCli([2, 0])
    const outcome = await stagedPromotion({ ...cli, retryMs: 7 })
    expect(outcome.promoted).toBe(true)
    expect(cli.probe).toHaveBeenCalledTimes(2)
    expect(cli.sleep).toHaveBeenCalledWith(7)
  })

  it("never promotes when the probe keeps failing, so the old deployment stays live", async () => {
    for (const exitCode of [1, 2, 64]) {
      const cli = mockCli(Array(PROBE_ATTEMPTS).fill(exitCode))
      const onProbe = vi.fn()
      const outcome = await stagedPromotion({ ...cli, onProbe })
      expect(outcome).toEqual({
        promoted: false,
        deployment: STAGED,
        probeExitCode: exitCode,
      })
      expect(cli.probe).toHaveBeenCalledTimes(PROBE_ATTEMPTS)
      expect(onProbe).toHaveBeenLastCalledWith(PROBE_ATTEMPTS, exitCode)
      expect(cli.promote).not.toHaveBeenCalled()
    }
  })

  it("does not probe or promote when the deploy fails", async () => {
    const cli = mockCli([0])
    cli.deploy.mockImplementation(() => {
      throw new Error("vercel deploy exited 1")
    })
    await expect(stagedPromotion(cli)).rejects.toThrow("vercel deploy exited 1")
    expect(cli.probe).not.toHaveBeenCalled()
    expect(cli.promote).not.toHaveBeenCalled()
  })

  it("reports the staged deployment before probing, so a failure can name it", async () => {
    const cli = mockCli([2, 2, 2])
    const order: string[] = []
    await stagedPromotion({
      ...cli,
      onDeployed: (deployment) => order.push(`deployed ${deployment.id}`),
      probe: (url) => {
        order.push("probe")
        return cli.probe(url)
      },
    })
    expect(order[0]).toBe("deployed dpl_staged")
  })
})

describe("production probe after vercel promote (G01)", () => {
  const PRODUCTION = "https://app.nabapresence.example"

  const served = (sha: string | null, status = "ready", exitCode = 0) => ({
    exitCode,
    status,
    servedSha: sha,
  })

  function mockProbe(results: ReturnType<typeof served>[]) {
    const queue = [...results]
    return {
      probe: vi.fn((url: string, sha: string) => {
        expect(url).toBe(PRODUCTION)
        expect(sha).toBe(SHA)
        return queue.shift() ?? served(null, "unreachable", 2)
      }),
      sleep: vi.fn(async () => {}),
      now: () => new Date("2026-10-10T12:05:00.000Z"),
    }
  }

  it("asks the probe for JSON, so the served SHA can be recorded", () => {
    expect(productionProbeArgs(PRODUCTION, SHA)).toEqual([
      "--url",
      PRODUCTION,
      "--expect-sha",
      SHA,
      "--json",
    ])
  })

  it("needs an https production origin, from the flag or READINESS_URL", () => {
    expect(resolveProductionUrl(`${PRODUCTION}/dashboard`, {})).toEqual({
      url: PRODUCTION,
      problem: null,
    })
    expect(resolveProductionUrl(null, { READINESS_URL: PRODUCTION }).url).toBe(
      PRODUCTION
    )
    expect(resolveProductionUrl(null, {}).problem).toMatch(/--production-url/)
    expect(resolveProductionUrl("http://app.example", {}).problem).toMatch(
      /https/
    )
    expect(resolveProductionUrl("not a url", {}).problem).toMatch(/valid URL/)
  })

  it("passes when production serves the promoted SHA", async () => {
    const io = mockProbe([served(SHA)])
    const verification = await verifyProduction({
      url: PRODUCTION,
      sha: SHA,
      ...io,
    })
    expect(verification).toEqual({
      url: PRODUCTION,
      expectSha: SHA,
      ok: true,
      status: "ready",
      servedSha: SHA,
      exitCode: 0,
      attempts: [{ attempt: 1, exitCode: 0, status: "ready", servedSha: SHA }],
      checkedAt: "2026-10-10T12:05:00.000Z",
    })
    expect(io.sleep).not.toHaveBeenCalled()
    expect(productionProbeReport(verification, { nextSteps: ["x"] })).toEqual({
      exitCode: 0,
      lines: [`production: ${PRODUCTION} serves ${SHA} (ready, attempt 1)`],
    })
  })

  it("retries while the domains still reach the old deployment", async () => {
    const io = mockProbe([
      served(OTHER_SHA, "release_mismatch", 2),
      served(SHA, "degraded"),
    ])
    const verification = await verifyProduction({
      url: PRODUCTION,
      sha: SHA,
      retryMs: 5,
      ...io,
    })
    expect(verification.ok).toBe(true)
    expect(verification.attempts).toHaveLength(2)
    expect(io.sleep).toHaveBeenCalledWith(5)
  })

  it("fails loudly with exit 3 when production keeps serving another SHA", async () => {
    const io = mockProbe(
      Array(PRODUCTION_PROBE_ATTEMPTS).fill(
        served(OTHER_SHA, "release_mismatch", 2)
      )
    )
    const verification = await verifyProduction({
      url: PRODUCTION,
      sha: SHA,
      ...io,
    })
    expect(verification).toMatchObject({
      ok: false,
      status: "release_mismatch",
      servedSha: OTHER_SHA,
      exitCode: 2,
    })
    expect(io.probe).toHaveBeenCalledTimes(PRODUCTION_PROBE_ATTEMPTS)
    expect(io.sleep).toHaveBeenCalledTimes(PRODUCTION_PROBE_ATTEMPTS - 1)
    const report = productionProbeReport(verification, {
      nextSteps: ["pnpm release:rollback"],
    })
    expect(report.exitCode).toBe(PRODUCTION_MISMATCH_EXIT)
    expect(report.exitCode).not.toBe(0)
    expect(report.lines[0]).toBe(
      `FAILED: production ${PRODUCTION} does not serve ${SHA} after ${PRODUCTION_PROBE_ATTEMPTS} probe attempt(s): it reports another release (exit 2), it serves ${OTHER_SHA}.`
    )
    expect(report.lines[1]).toBe("Next: pnpm release:rollback")
  })

  it("never passes on exit 0 without the promoted SHA in the answer", async () => {
    const io = mockProbe(Array(PRODUCTION_PROBE_ATTEMPTS).fill(served(null)))
    const verification = await verifyProduction({
      url: PRODUCTION,
      sha: SHA,
      ...io,
    })
    expect(verification.ok).toBe(false)
    expect(io.probe).toHaveBeenCalledTimes(PRODUCTION_PROBE_ATTEMPTS)
  })

  it("records a probe that timed out on every attempt as a failure", async () => {
    const timedOut = probeResultFromSpawn({
      status: null,
      signal: "SIGTERM",
      error: { code: "ETIMEDOUT" },
      stdout: "",
    })
    expect(timedOut).toEqual({
      exitCode: PROBE_TIMEOUT_EXIT,
      status: "timeout",
      servedSha: null,
    })
    const io = mockProbe(Array(PRODUCTION_PROBE_ATTEMPTS).fill(timedOut))
    const verification = await verifyProduction({
      url: PRODUCTION,
      sha: SHA,
      ...io,
    })
    expect(verification).toMatchObject({
      ok: false,
      status: "timeout",
      exitCode: PROBE_TIMEOUT_EXIT,
    })
    expect(verification.attempts).toHaveLength(PRODUCTION_PROBE_ATTEMPTS)
    const report = productionProbeReport(verification, { nextSteps: [] })
    expect(report.exitCode).toBe(PRODUCTION_MISMATCH_EXIT)
    expect(report.lines[0]).toMatch(/the probe timed out \(exit 124\)\.$/)
  })

  it("stops at once on a probe usage error", async () => {
    const io = mockProbe([served(null, "unreadable", 64)])
    const verification = await verifyProduction({
      url: PRODUCTION,
      sha: SHA,
      ...io,
    })
    expect(verification.ok).toBe(false)
    expect(io.probe).toHaveBeenCalledTimes(1)
  })

  it("reads the probe's JSON line, and never trusts unreadable output", () => {
    const json = (body: unknown, status: string) =>
      JSON.stringify({ exitCode: 0, status, httpStatus: 200, body })
    expect(
      probeResultFromSpawn({
        status: 0,
        stdout: `${json({ status: "ready", release: { sha: SHA } }, "ready")}\n`,
      })
    ).toEqual({ exitCode: 0, status: "ready", servedSha: SHA })
    expect(
      probeResultFromSpawn({
        status: 2,
        stdout: json(
          { status: "ready", release: { sha: OTHER_SHA } },
          "release_mismatch"
        ),
      })
    ).toEqual({ exitCode: 2, status: "release_mismatch", servedSha: OTHER_SHA })
    expect(
      probeResultFromSpawn({ status: 0, stdout: "readiness: ready" })
    ).toEqual({ exitCode: 2, status: "unreadable", servedSha: null })
    expect(
      probeResultFromSpawn({
        status: 2,
        stdout: json({ release: { sha: "unknown" } }, "unreachable"),
      })
    ).toEqual({ exitCode: 2, status: "unreachable", servedSha: null })
  })

  it("records the production probe in the promotion receipt", async () => {
    const io = mockProbe([served(SHA)])
    const productionProbe = await verifyProduction({
      url: PRODUCTION,
      sha: SHA,
      ...io,
    })
    const receipt = buildReceipt({
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
      migrations: [],
      configNames: ["CRON_SECRET"],
      operator: "release-operator",
      timestamp: "2026-10-10T12:00:00.000Z",
      productionProbe,
    })
    expect(receipt.productionProbe).toEqual(productionProbe)
    expect(secretLikePaths(receipt)).toEqual([])
  })
})
