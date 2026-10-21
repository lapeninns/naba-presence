import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"

import { latestPromotedRelease } from "../../scripts/release/local-receipt.mjs"
import { promoteArgs } from "../../scripts/release/promote.mjs"
import {
  buildRollbackReceipt,
  EXIT,
  migrationDrift,
  parseRollbackArgs,
  planRollback,
  readReceiptHistory,
  ROLLBACK_RECEIPT_KIND,
  rollbackReceiptFileName,
  runRollback,
} from "../../scripts/release/rollback.mjs"

const SHA_A = "a".repeat(40)
const SHA_B = "b".repeat(40)
const SHA_C = "c".repeat(40)
const PRODUCTION = "https://app.nabapresence.example"
const DIR = "/receipts"

const m = (version: string, sha256 = "1".repeat(64)) => ({ version, sha256 })
const BASE_MIGRATIONS = [m("0001_init"), m("0002_reviews")]

const promotion = (
  file: string,
  sha: string,
  deploymentId: string,
  migrations: unknown = BASE_MIGRATIONS
) => ({
  name: file,
  content: JSON.stringify({
    sha,
    deploymentId,
    url: `https://naba-${deploymentId}.vercel.app`,
    localGate: { file: "x.json" },
    migrations,
    configNames: ["CRON_SECRET"],
    operator: "release-operator",
    timestamp: "2026-10-10T12:00:00.000Z",
  }),
})

const A = promotion("20261010T120000Z-aaaaaaaaaaaa.json", SHA_A, "dpl_a")
const B = promotion("20261011T120000Z-bbbbbbbbbbbb.json", SHA_B, "dpl_b")
const C = promotion("20261012T120000Z-cccccccccccc.json", SHA_C, "dpl_c")
const NOISE = [
  { name: "20261012T120000Z-cccccccccccc.local.json", content: "{}" },
  { name: "README.md", content: "# Release receipts" },
]

const history = (files: { name: string; content: string }[]) =>
  readReceiptHistory(files)

const plan = (
  files: { name: string; content: string }[],
  options: { to?: string; databaseRestored?: boolean } = {}
) => {
  const { promotions, rollbacks, problems } = history(files)
  expect(problems).toEqual([])
  return planRollback({ promotions, rollbacks, ...options })
}

const ready = (sha: string | null) => ({
  exitCode: sha ? 0 : 2,
  status: sha ? "ready" : "unreachable",
  servedSha: sha,
})

// The whole CLI with every effect mocked: the receipts directory, the Vercel
// CLI, the probe, the receipt write and the clock.
function cli(
  files: { name: string; content: string }[] | null,
  {
    probeResults = [ready(SHA_B)],
    env = { READINESS_PROBE_TOKEN: "probe-token" },
  }: {
    probeResults?: ReturnType<typeof ready>[]
    env?: Record<string, string | undefined>
  } = {}
) {
  const queue = [...probeResults]
  const out: string[] = []
  const err: string[] = []
  const written: { path: string; content: string }[] = []
  const io = {
    env,
    receiptsDir: DIR,
    listReceipts: vi.fn((dir: string) => {
      expect(dir).toBe(DIR)
      if (files === null) {
        throw new Error(`ENOENT: no such file or directory, scandir '${dir}'`)
      }
      return files
    }),
    promote: vi.fn(),
    probe: vi.fn(() => queue.shift() ?? ready(null)),
    writeReceipt: vi.fn((path: string, content: string) => {
      written.push({ path, content })
    }),
    operator: () => "release-operator",
    log: (line: string) => out.push(line),
    error: (line: string) => err.push(line),
    sleep: vi.fn(async () => {}),
    now: () => new Date("2026-10-13T09:30:00.000Z"),
  }
  return {
    io,
    out,
    err,
    written,
    run: (argv: string[]) => runRollback({ ...io, argv }),
  }
}

describe("release:rollback planning", () => {
  it("returns to the promotion before the one production serves", () => {
    const result = plan([C, A, ...NOISE, B])
    expect(result.ok).toBe(true)
    expect(result.current?.deploymentId).toBe("dpl_c")
    expect(result.target).toMatchObject({
      file: B.name,
      sha: SHA_B,
      deploymentId: "dpl_b",
    })
    expect(result.drift).toEqual({
      notInTarget: [],
      notInProduction: [],
      changed: [],
    })
  })

  it("after a rollback, serves its target and goes back one more", () => {
    const rolledBack = {
      name: "20261013T090000Z-bbbbbbbbbbbb.rollback.json",
      content: JSON.stringify({
        kind: ROLLBACK_RECEIPT_KIND,
        to: { receipt: B.name, deploymentId: "dpl_b" },
        migrations: { databaseRestored: false },
      }),
    }
    const result = plan([A, B, C, rolledBack])
    expect(result.current?.deploymentId).toBe("dpl_b")
    expect(result.target?.deploymentId).toBe("dpl_a")
  })

  it("picks --to by receipt file, file without .json, path or deploymentId", () => {
    for (const to of [
      A.name,
      A.name.replace(/\.json$/, ""),
      `docs/release/receipts/${A.name}`,
      "dpl_a",
    ]) {
      const result = plan([A, B, C], { to })
      expect(result.ok).toBe(true)
      expect(result.target?.deploymentId).toBe("dpl_a")
    }
  })

  it("refuses a --to that matches nothing, or what production already serves", () => {
    expect(plan([A, B, C], { to: "dpl_missing" }).problems).toEqual([
      "--to dpl_missing matches no promotion receipt or deploymentId",
    ])
    const same = plan([A, B, C], { to: "dpl_c" })
    expect(same.ok).toBe(false)
    expect(same.problems).toEqual([
      `production already serves dpl_c (${C.name})`,
    ])
  })

  it("refuses without receipts, or with only one promotion", () => {
    expect(planRollback({ promotions: [], rollbacks: [] }).problems[0]).toMatch(
      /no promotion receipts/
    )
    const only = plan([A, ...NOISE])
    expect(only.ok).toBe(false)
    expect(only.problems[0]).toMatch(/earliest promotion receipt/)
  })

  it("refuses when production has migrations the target does not ship", () => {
    const withMigration = promotion(C.name, SHA_C, "dpl_c", [
      ...BASE_MIGRATIONS,
      m("0003_reply_drafts"),
    ])
    const result = plan([A, B, withMigration])
    expect(result.ok).toBe(false)
    expect(result.drift).toEqual({
      notInTarget: ["0003_reply_drafts"],
      notInProduction: [],
      changed: [],
    })
    expect(result.problems).toEqual([
      `production's database has 1 migration(s) ${B.name} does not ship (0003_reply_drafts); a deployment rollback cannot undo a migration`,
      expect.stringMatching(
        /^database rollback is a manual runbook step .*--database-restored$/
      ),
    ])
  })

  it("refuses an edited migration file, or one production never applied", () => {
    const edited = promotion(B.name, SHA_B, "dpl_b", [
      m("0001_init"),
      m("0002_reviews", "2".repeat(64)),
    ])
    expect(plan([A, edited, C]).drift?.changed).toEqual(["0002_reviews"])
    expect(plan([A, edited, C]).ok).toBe(false)

    const ahead = promotion(A.name, SHA_A, "dpl_a", [
      ...BASE_MIGRATIONS,
      m("0009_future"),
    ])
    const result = plan([ahead, B, C], { to: "dpl_a" })
    expect(result.ok).toBe(false)
    expect(result.drift?.notInProduction).toEqual(["0009_future"])
  })

  it("proceeds across a migration only once the operator restored the database", () => {
    const withMigration = promotion(C.name, SHA_C, "dpl_c", [
      ...BASE_MIGRATIONS,
      m("0003_reply_drafts"),
    ])
    const result = plan([A, B, withMigration], { databaseRestored: true })
    expect(result.ok).toBe(true)
    expect(result.drift?.notInTarget).toEqual(["0003_reply_drafts"])
  })

  it("takes production's schema from a later restored rollback", () => {
    const withMigration = promotion(C.name, SHA_C, "dpl_c", [
      ...BASE_MIGRATIONS,
      m("0003_reply_drafts"),
    ])
    const rollback = (restored: boolean) => ({
      name: "20261013T090000Z-bbbbbbbbbbbb.rollback.json",
      content: JSON.stringify({
        kind: ROLLBACK_RECEIPT_KIND,
        to: { receipt: B.name, deploymentId: "dpl_b" },
        migrations: { databaseRestored: restored },
      }),
    })
    // Not restored: the database still has 0003, which A does not ship.
    expect(plan([A, B, withMigration, rollback(false)]).ok).toBe(false)
    // Restored to B's schema: A ships the same migrations.
    expect(plan([A, B, withMigration, rollback(true)]).ok).toBe(true)
  })

  it("refuses when a receipt records no migrations, even with --database-restored", () => {
    const old = promotion(B.name, SHA_B, "dpl_b", null)
    for (const databaseRestored of [false, true]) {
      const result = plan([A, old, C], { databaseRestored })
      expect(result.ok).toBe(false)
      expect(result.problems[0]).toMatch(/cannot compare migrations/)
    }
  })

  it("reports unreadable receipts instead of skipping them", () => {
    const { problems, promotions } = history([
      A,
      { name: B.name, content: "{not json" },
      { name: C.name, content: JSON.stringify({ sha: "short" }) },
      {
        name: "20261013T090000Z-aaaaaaaaaaaa.rollback.json",
        content: JSON.stringify({ kind: "other" }),
      },
    ])
    expect(promotions.map((p) => p.file)).toEqual([A.name])
    expect(problems).toEqual([
      `${B.name} is not valid JSON`,
      `${C.name} has no readable sha and deploymentId`,
      "20261013T090000Z-aaaaaaaaaaaa.rollback.json is not a readable rollback receipt",
    ])
  })

  it("refuses a rollback receipt naming a promotion that is not there", () => {
    const { promotions, rollbacks } = history([
      A,
      C,
      {
        name: "20261013T090000Z-bbbbbbbbbbbb.rollback.json",
        content: JSON.stringify({
          kind: ROLLBACK_RECEIPT_KIND,
          to: { receipt: B.name, deploymentId: "dpl_b" },
        }),
      },
    ])
    const result = planRollback({ promotions, rollbacks })
    expect(result.ok).toBe(false)
    expect(result.problems[0]).toMatch(
      /which no promotion receipt here matches/
    )
  })

  it("compares migrations by version and content", () => {
    expect(
      migrationDrift(
        [m("1"), m("2"), m("3", "x")],
        [m("1"), m("3", "y"), m("4")]
      )
    ).toEqual({ notInTarget: ["2"], notInProduction: ["4"], changed: ["3"] })
  })

  it("reads the committed receipts in this repository", () => {
    const dir = new URL("../../docs/release/receipts/", import.meta.url)
    const files = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => ({
        name,
        content: readFileSync(new URL(name, dir), "utf8"),
      }))
    const { promotions, problems } = readReceiptHistory(files)
    expect(problems).toEqual([])
    expect(promotions.length).toBeGreaterThan(0)
    for (const promotion of promotions) {
      expect(promotion.deploymentId).toMatch(/^dpl_/)
      expect(promotion.migrations?.length).toBeGreaterThan(0)
    }
  })
})

describe("release:rollback CLI", () => {
  it("defaults to a dry run that prints the plan and executes nothing", async () => {
    const { run, io, out, err, written } = cli([A, B, C, ...NOISE])
    const code = await run(["--production-url", PRODUCTION])
    expect(code).toBe(EXIT.ok)
    expect(err).toEqual([])
    expect(out).toEqual([
      `production serves (per the receipts): dpl_c at ${SHA_C} (${C.name})`,
      `roll back to: dpl_b at ${SHA_B} (${B.name})`,
      "migrations: production's and the target's are identical",
      "Dry run: would run vercel promote dpl_b --yes --timeout 5m",
      `Dry run: then node scripts/ops/readiness-probe.mjs --url ${PRODUCTION} --expect-sha ${SHA_B} --json, up to 5 attempts`,
      `Dry run: then write ${DIR}/<UTC time>-bbbbbbbbbbbb.rollback.json`,
      "Dry run: nothing executed. Rerun with --yes to roll back.",
    ])
    expect(io.promote).not.toHaveBeenCalled()
    expect(io.probe).not.toHaveBeenCalled()
    expect(io.writeReceipt).not.toHaveBeenCalled()
    expect(written).toEqual([])
  })

  it("--dry-run is the same as no flag", async () => {
    const { run, io } = cli([A, B, C])
    expect(await run(["--dry-run", "--production-url", PRODUCTION])).toBe(0)
    expect(io.promote).not.toHaveBeenCalled()
  })

  it("with --yes promotes the target, probes production and writes a receipt", async () => {
    const order: string[] = []
    const { run, io, out, written } = cli([A, B, C])
    io.promote.mockImplementation((id: string) => {
      order.push(`vercel ${promoteArgs(id).join(" ")}`)
    })
    io.probe.mockImplementation(((url: string, sha: string) => {
      order.push(`probe ${url} ${sha}`)
      return ready(SHA_B)
    }) as never)
    io.writeReceipt.mockImplementation((path: string, content: string) => {
      order.push(`write ${path}`)
      written.push({ path, content })
    })

    const code = await run(["--yes", "--production-url", PRODUCTION])
    expect(code).toBe(EXIT.ok)
    expect(order).toEqual([
      "vercel promote dpl_b --yes --timeout 5m",
      `probe ${PRODUCTION} ${SHA_B}`,
      `write ${DIR}/20261013T093000Z-bbbbbbbbbbbb.rollback.json`,
    ])
    const receipt = JSON.parse(written[0].content)
    expect(receipt).toMatchObject({
      kind: ROLLBACK_RECEIPT_KIND,
      version: 1,
      sha: SHA_B,
      deploymentId: "dpl_b",
      to: { receipt: B.name, sha: SHA_B, deploymentId: "dpl_b" },
      from: { receipt: C.name, sha: SHA_C, deploymentId: "dpl_c" },
      migrations: { databaseRestored: false },
      productionProbe: { ok: true, expectSha: SHA_B, servedSha: SHA_B },
      operator: "release-operator",
      timestamp: "2026-10-13T09:30:00.000Z",
    })
    expect(out.at(-1)).toMatch(/^Next: commit the rollback receipt/)
    // The written receipt becomes history: production now serves B.
    const after = plan([
      A,
      B,
      C,
      { name: written[0].path, content: written[0].content },
    ])
    expect(after.current?.deploymentId).toBe("dpl_b")
  })

  it("rolls back to --to with --yes", async () => {
    const { run, io } = cli([A, B, C], { probeResults: [ready(SHA_A)] })
    expect(
      await run(["--yes", "--to", "dpl_a", "--production-url", PRODUCTION])
    ).toBe(EXIT.ok)
    expect(io.promote).toHaveBeenCalledWith("dpl_a")
    expect(io.probe).toHaveBeenCalledWith(PRODUCTION, SHA_A)
  })

  it("exits 3 and still writes the receipt when production does not serve the target", async () => {
    const { run, io, err, written } = cli([A, B, C], {
      probeResults: Array(5).fill({
        exitCode: 2,
        status: "release_mismatch",
        servedSha: SHA_C,
      }),
    })
    const code = await run(["--yes", "--production-url", PRODUCTION])
    expect(code).toBe(3)
    expect(io.probe).toHaveBeenCalledTimes(5)
    expect(written).toHaveLength(1)
    expect(JSON.parse(written[0].content).productionProbe).toMatchObject({
      ok: false,
      status: "release_mismatch",
      servedSha: SHA_C,
    })
    expect(err).toContain(
      `FAILED: production ${PRODUCTION} does not serve ${SHA_B} after 5 probe attempt(s): it reports another release (exit 2), it serves ${SHA_C}.`
    )
  })

  it("writes no receipt when vercel promote fails", async () => {
    const { run, io, err } = cli([A, B, C])
    io.promote.mockImplementation(() => {
      throw new Error("vercel promote exited 1")
    })
    expect(await run(["--yes", "--production-url", PRODUCTION])).toBe(
      EXIT.refused
    )
    expect(io.probe).not.toHaveBeenCalled()
    expect(io.writeReceipt).not.toHaveBeenCalled()
    expect(err[0]).toMatch(
      /vercel promote dpl_b failed: vercel promote exited 1/
    )
  })

  it("refuses a migration rollback with --yes, executing nothing", async () => {
    const withMigration = promotion(C.name, SHA_C, "dpl_c", [
      ...BASE_MIGRATIONS,
      m("0003_reply_drafts"),
    ])
    const { run, io, err } = cli([A, B, withMigration])
    expect(await run(["--yes", "--production-url", PRODUCTION])).toBe(
      EXIT.refused
    )
    expect(io.promote).not.toHaveBeenCalled()
    expect(io.writeReceipt).not.toHaveBeenCalled()
    expect(err.join("\n")).toMatch(
      /a deployment rollback cannot undo a migration/
    )
    expect(err.join("\n")).toMatch(/database rollback is a manual runbook step/)
  })

  it("records --database-restored in the receipt", async () => {
    const withMigration = promotion(C.name, SHA_C, "dpl_c", [
      ...BASE_MIGRATIONS,
      m("0003_reply_drafts"),
    ])
    const { run, written } = cli([A, B, withMigration])
    expect(
      await run([
        "--yes",
        "--database-restored",
        "--production-url",
        PRODUCTION,
      ])
    ).toBe(EXIT.ok)
    expect(JSON.parse(written[0].content).migrations).toEqual({
      databaseRestored: true,
      drift: {
        notInTarget: ["0003_reply_drafts"],
        notInProduction: [],
        changed: [],
      },
    })
  })

  it("refuses a missing or empty receipts directory", async () => {
    const missing = cli(null)
    expect(await missing.run(["--production-url", PRODUCTION])).toBe(
      EXIT.refused
    )
    expect(missing.err[0]).toMatch(/^refused: cannot read \/receipts: ENOENT/)

    const empty = cli(NOISE)
    expect(await empty.run(["--yes", "--production-url", PRODUCTION])).toBe(
      EXIT.refused
    )
    expect(empty.err[0]).toMatch(/no promotion receipts/)
    expect(empty.io.promote).not.toHaveBeenCalled()
  })

  it("refuses an unreadable receipt rather than skipping it", async () => {
    const { run, io, err } = cli([A, B, { name: C.name, content: "{" }])
    expect(await run(["--yes", "--production-url", PRODUCTION])).toBe(
      EXIT.refused
    )
    expect(err).toContain(`refused: receipts: ${C.name} is not valid JSON`)
    expect(io.promote).not.toHaveBeenCalled()
  })

  it("refuses without a production URL or a probe token", async () => {
    const noUrl = cli([A, B, C])
    expect(await noUrl.run(["--yes"])).toBe(EXIT.refused)
    expect(noUrl.err.join("\n")).toMatch(/--production-url/)
    expect(noUrl.io.promote).not.toHaveBeenCalled()

    const fromEnv = cli([A, B, C], {
      env: { READINESS_PROBE_TOKEN: "t", READINESS_URL: PRODUCTION },
    })
    expect(await fromEnv.run([])).toBe(EXIT.ok)

    const noToken = cli([A, B, C], { env: {} })
    expect(await noToken.run(["--yes", "--production-url", PRODUCTION])).toBe(
      EXIT.refused
    )
    expect(noToken.err.join("\n")).toMatch(/READINESS_PROBE_TOKEN/)
    expect(noToken.io.promote).not.toHaveBeenCalled()
  })

  it("treats unknown or incomplete flags as usage errors", async () => {
    expect(() => parseRollbackArgs(["--to"])).toThrow(/--to needs a value/)
    expect(() => parseRollbackArgs(["--yes", "--dry-run"])).toThrow(/not both/)
    expect(parseRollbackArgs(["--", "--yes", "--to", "dpl_a"])).toMatchObject({
      yes: true,
      to: "dpl_a",
    })
    const { run, io } = cli([A, B, C])
    expect(await run(["--force"])).toBe(EXIT.usage)
    expect(io.listReceipts).not.toHaveBeenCalled()
  })
})

describe("release:rollback receipt", () => {
  const current = {
    file: C.name,
    sha: SHA_C,
    deploymentId: "dpl_c",
    url: "https://naba-dpl_c.vercel.app",
    migrations: [],
  }
  const target = { ...current, file: B.name, sha: SHA_B, deploymentId: "dpl_b" }
  const productionProbe = {
    url: PRODUCTION,
    expectSha: SHA_B,
    ok: true,
    status: "ready",
    servedSha: SHA_B,
    exitCode: 0,
    attempts: [],
    checkedAt: "2026-10-13T09:30:00.000Z",
  }

  it("is named by time and the target commit, apart from promotion receipts", () => {
    const receipt = buildRollbackReceipt({
      current,
      target,
      drift: null,
      databaseRestored: false,
      productionProbe,
      operator: "release-operator",
      timestamp: "2026-10-13T09:30:00.123Z",
    })
    expect(rollbackReceiptFileName(receipt)).toBe(
      "20261013T093000Z-bbbbbbbbbbbb.rollback.json"
    )
    // The promotion-receipt reader (the next gate's base, promote's
    // previous SHA) does not take it for a promotion.
    expect(
      latestPromotedRelease([
        A,
        {
          name: rollbackReceiptFileName(receipt),
          content: JSON.stringify(receipt),
        },
      ])
    ).toEqual({ file: A.name, sha: SHA_A })
  })

  it("refuses anything redaction would touch", () => {
    expect(() =>
      buildRollbackReceipt({
        current,
        target,
        drift: null,
        databaseRestored: false,
        productionProbe,
        operator: "Bearer abcdefghijklmnopqrstuvwxyz0123456789",
        timestamp: "2026-10-13T09:30:00.000Z",
      })
    ).toThrow(/secret-like values at \$\.operator/)
  })
})
