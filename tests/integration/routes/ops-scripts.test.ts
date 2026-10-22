import { execFile } from "node:child_process"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { promisify } from "node:util"

import postgres from "postgres"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import { assertLocalDatabaseUrl } from "../../../scripts/run-test-command.mjs"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const exec = promisify(execFile)

type Outcome = { code: number; stdout: string; stderr: string }

/**
 * NP8-G04: the operator CLIs, executed as an operator types them, against
 * the throwaway cluster. The SQL they call (set_ops_pause, 0090;
 * revoke_support_sessions, 0084) is tested elsewhere; this pins flag
 * parsing, refusals, exit codes, what they print and what they write.
 *
 * Neither script refuses a non-local database: both are built to run
 * against production with the owner connection, and print the target
 * (`Database: host:port/db`) before acting. That line is pinned here. The
 * child gets only PATH, NODE_ENV and DIRECT_DATABASE_URL, checked local first, so an
 * operator's .env cannot redirect it (explicit variables win over
 * @next/env files).
 */
describeDatabase("operator scripts", () => {
  let admin: ReturnType<typeof postgres>
  let url: string
  let target: string
  const organisations: string[] = []
  const pausedScopes = new Set<string>()

  async function script(file: string, args: string[]): Promise<Outcome> {
    assertLocalDatabaseUrl("DIRECT_DATABASE_URL", { DIRECT_DATABASE_URL: url })
    try {
      const { stdout, stderr } = await exec("node", [file, ...args], {
        // NODE_ENV=test as under vitest: @next/env then skips .env.local.
        env: {
          PATH: process.env.PATH!,
          NODE_ENV: "test",
          DIRECT_DATABASE_URL: url,
        },
      })
      return { code: 0, stdout, stderr }
    } catch (error) {
      const failed = error as {
        code?: number
        stdout?: string
        stderr?: string
      }
      return {
        code: typeof failed.code === "number" ? failed.code : -1,
        stdout: failed.stdout ?? "",
        stderr: failed.stderr ?? "",
      }
    }
  }

  const opsPause = (...args: string[]) => script("scripts/ops-pause.mjs", args)
  const revoke = (...args: string[]) =>
    script("scripts/revoke-support-sessions.mjs", args)

  beforeAll(async () => {
    url = process.env.DIRECT_DATABASE_URL!
    assertLocalDatabaseUrl("DIRECT_DATABASE_URL", { DIRECT_DATABASE_URL: url })
    const parsed = new URL(url)
    target = `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`
    admin = postgres(url, { max: 1, onnotice: () => {} })
  })

  afterEach(async () => {
    // The pause table is platform-wide: never leave a scope paused for the
    // next suite sharing the database.
    for (const scope of pausedScopes) {
      await admin`
        select * from set_ops_pause(
          ${scope}, false, 'ops-scripts.test cleanup', 'ops-scripts.test'
        )
      `
    }
    pausedScopes.clear()
  })

  afterAll(async () => {
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  describe("scripts/ops-pause.mjs", () => {
    const events = (operator: string) =>
      admin<{ scope: string; paused: boolean; reason: string }[]>`
        select scope, paused, reason
        from ops_pause_event
        where changed_by = ${operator}
        order by id
      `

    it("shows the target and every scope's state", async () => {
      const status = await opsPause("status")
      expect(status.code, status.stderr).toBe(0)
      expect(status.stdout).toContain(`Database: ${target}\n`)
      expect(status.stdout).toContain("Operator pauses")
      expect(status.stdout).toContain("  drafts: running")
    })

    it("pauses and resumes a scope, recording the operator and reason each time", async () => {
      const operator = `ops-${randomUUID()}@example.test`
      const reason = "Integration: Google incident drill"
      pausedScopes.add("drafts")

      const paused = await opsPause(
        "pause",
        "--scope",
        "drafts",
        "--operator",
        operator,
        "--reason",
        reason
      )
      expect(paused.code, paused.stderr).toBe(0)
      expect(paused.stdout).toContain(`Database: ${target}\n`)
      expect(paused.stdout).toContain("drafts: paused.")
      expect(paused.stdout).toMatch(
        new RegExp(`  drafts: PAUSED since \\S+ by ${operator}: ${reason}`)
      )
      const [control] = await admin<
        { paused: boolean; reason: string; changedBy: string }[]
      >`
        select paused, reason, changed_by as "changedBy"
        from ops_pause_control
        where scope = 'drafts'
      `
      expect(control).toEqual({ paused: true, reason, changedBy: operator })

      const again = await opsPause(
        "pause",
        "--scope",
        "drafts",
        "--operator",
        operator,
        "--reason",
        reason
      )
      expect(again.code, again.stderr).toBe(0)
      expect(again.stdout).toContain("drafts: already paused (recorded).")

      const resumed = await opsPause(
        "resume",
        "--scope",
        "drafts",
        "--operator",
        operator,
        "--reason",
        "Integration: drill over"
      )
      expect(resumed.code, resumed.stderr).toBe(0)
      expect(resumed.stdout).toContain("drafts: resumed.")
      expect(resumed.stdout).toContain("  drafts: running")

      expect(await events(operator)).toEqual([
        { scope: "drafts", paused: true, reason },
        { scope: "drafts", paused: true, reason },
        { scope: "drafts", paused: false, reason: "Integration: drill over" },
      ])
    })

    it("refuses an incomplete or unknown command and writes nothing", async () => {
      const operator = `ops-${randomUUID()}@example.test`
      // Resumed afterwards should a refusal ever stop refusing.
      pausedScopes.add("drafts")
      const cases: [string[], string][] = [
        [["restart"], "Unknown command restart"],
        [
          ["pause", "--scope", "drafts", "--reason", "Long enough reason"],
          "--operator is required.",
        ],
        [
          ["pause", "--operator", operator, "--reason", "Long enough reason"],
          "--scope is required.",
        ],
        [
          ["pause", "--scope", "drafts", "--operator", operator],
          "--reason is required (at least 10 characters).",
        ],
        [
          [
            "pause",
            "--scope",
            "drafts",
            "--operator",
            operator,
            "--reason",
            "short",
          ],
          "--reason is required (at least 10 characters).",
        ],
        [
          [
            "feature",
            "--organisation",
            randomUUID(),
            "--feature",
            "post_scheduling",
            "--enable",
            "--disable",
            "--operator",
            operator,
          ],
          "Pass exactly one of --enable or --disable.",
        ],
        [
          [
            "feature",
            "--organisation",
            randomUUID(),
            "--feature",
            "post_schedulng",
            "--enable",
            "--operator",
            operator,
          ],
          "Unknown feature post_schedulng",
        ],
      ]
      for (const [args, message] of cases) {
        const outcome = await opsPause(...args)
        expect(outcome.code, args.join(" ")).not.toBe(0)
        expect(outcome.stderr, args.join(" ")).toContain(message)
        // Refused before connecting: no target line, no state printed.
        expect(outcome.stdout, args.join(" ")).toBe("")
      }
      expect(await events(operator)).toEqual([])
      const [control] = await admin<{ paused: boolean }[]>`
        select paused from ops_pause_control where scope = 'drafts'
      `
      expect(control.paused).toBe(false)
    })

    it("switches one organisation's feature on and off", async () => {
      const owner = await createTestTenant(admin)
      organisations.push(owner.organisationId)
      const operator = `ops-${randomUUID()}@example.test`
      const feature = (state: "--enable" | "--disable") =>
        opsPause(
          "feature",
          "--organisation",
          owner.organisationId,
          "--feature",
          "post_scheduling",
          state,
          "--operator",
          operator
        )
      const read = async () => {
        const [row] = await admin<{ enabled: boolean; changedBy: string }[]>`
          select enabled, changed_by as "changedBy"
          from organisation_feature
          where organisation_id = ${owner.organisationId}
            and feature = 'post_scheduling'
        `
        return row
      }

      const on = await feature("--enable")
      expect(on.code, on.stderr).toBe(0)
      expect(on.stdout).toContain(
        `${owner.organisationId}: post_scheduling enabled.`
      )
      expect(await read()).toEqual({ enabled: true, changedBy: operator })

      const off = await feature("--disable")
      expect(off.code, off.stderr).toBe(0)
      expect(off.stdout).toContain(
        `${owner.organisationId}: post_scheduling disabled.`
      )
      expect(await read()).toEqual({ enabled: false, changedBy: operator })
    })
  })

  describe("scripts/revoke-support-sessions.mjs", () => {
    async function supportSession(organisationId: string, userId: string) {
      await admin`
        insert into app_session (
          token_hash, user_id, organisation_id, expires_at,
          support_actor, impersonation_reason
        )
        values (
          ${createHash("sha256").update(randomBytes(32)).digest("hex")},
          ${userId}, ${organisationId}, now() + interval '1 hour',
          'support@nabapresence.test', 'Ticket 1234: listing check'
        )
      `
    }
    const sessions = (organisationId: string) =>
      admin<{ support: boolean }[]>`
        select support_actor is not null as support
        from app_session
        where organisation_id = ${organisationId}
        order by 1
      `
    const audits = (organisationId: string) =>
      admin<{ metadata: Record<string, unknown> }[]>`
        select metadata
        from audit_log
        where organisation_id = ${organisationId}
          and action = 'support.sessions_revoked'
      `

    it("refuses without an operator or a real reason, revoking nothing", async () => {
      const owner = await createTestTenant(admin)
      organisations.push(owner.organisationId)
      await supportSession(owner.organisationId, owner.userId)

      for (const [args, message] of [
        [
          ["--reason", "Pilot launch: impersonation off"],
          "--operator is required.",
        ],
        [
          ["--operator", "ops@example.test"],
          "--reason is required (at least 10 characters).",
        ],
        [
          ["--operator", "ops@example.test", "--reason", "too short"],
          "--reason is required (at least 10 characters).",
        ],
      ] as const) {
        const outcome = await revoke(...args)
        expect(outcome.code, args.join(" ")).not.toBe(0)
        expect(outcome.stderr, args.join(" ")).toContain(message)
        expect(outcome.stdout, args.join(" ")).toBe("")
      }
      expect(await sessions(owner.organisationId)).toEqual([
        { support: false },
        { support: true },
      ])
    })

    it("counts on a dry run, then revokes only support sessions and audits each organisation", async () => {
      const a = await createTestTenant(admin)
      const b = await createTestTenant(admin)
      organisations.push(a.organisationId, b.organisationId)
      await supportSession(a.organisationId, a.userId)
      await supportSession(a.organisationId, a.userId)
      await supportSession(b.organisationId, b.userId)
      const args = [
        "--operator",
        "ops@example.test",
        "--reason",
        "Pilot launch: impersonation off",
      ]

      const dry = await revoke(...args, "--dry-run")
      expect(dry.code, dry.stderr).toBe(0)
      expect(dry.stdout).toContain(`Database: ${target}\n`)
      expect(dry.stdout).toContain(`  ${a.organisationId}: 2\n`)
      expect(dry.stdout).toContain(`  ${b.organisationId}: 1\n`)
      expect(dry.stdout).toContain("Dry run: nothing revoked.")
      expect(await sessions(a.organisationId)).toHaveLength(3)
      expect(await audits(a.organisationId)).toEqual([])

      const done = await revoke(...args)
      expect(done.code, done.stderr).toBe(0)
      expect(done.stdout).toMatch(
        /Revoked \d+ support session\(s\); audited as support\.sessions_revoked\./
      )
      // Each tenant keeps its own session; the support sessions are gone.
      expect(await sessions(a.organisationId)).toEqual([{ support: false }])
      expect(await sessions(b.organisationId)).toEqual([{ support: false }])
      expect(await audits(a.organisationId)).toEqual([
        {
          metadata: {
            operator: "ops@example.test",
            reason: "Pilot launch: impersonation off",
            revokedSessions: 2,
            supportActors: ["support@nabapresence.test"],
          },
        },
      ])
      expect(await audits(b.organisationId)).toEqual([
        {
          metadata: expect.objectContaining({ revokedSessions: 1 }),
        },
      ])
    })
  })
})
