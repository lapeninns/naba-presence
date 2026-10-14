import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  EXIT,
  judgeReadiness,
  parseProbeArgs,
  promotedSha,
  UsageError,
} from "../../scripts/ops/readiness-probe.mjs"

const SHA = "0123456789abcdef0123456789abcdef01234567"
const OTHER = "89abcdef0123456789abcdef0123456789abcdef"
const TOKEN = { READINESS_PROBE_TOKEN: "probe-token-value" }

const body = (status: string, extra: Record<string, unknown> = {}) => ({
  status,
  release: { sha: SHA, source: "naba_release_sha" },
  reasons: [],
  ...extra,
})

describe("readiness probe arguments", () => {
  it("builds the readiness URL and takes the token from the environment", () => {
    const options = parseProbeArgs(
      ["--url", "https://app.example.com/x"],
      TOKEN
    )
    expect(options.url).toBe("https://app.example.com/api/operations/readiness")
    expect(options.token).toBe("probe-token-value")
    expect(
      parseProbeArgs([], {
        READINESS_URL: "http://localhost:3000",
        CRON_SECRET: "cron-secret-value",
      }).token
    ).toBe("cron-secret-value")
  })

  it("sends the deployment-protection bypass only over https", () => {
    const env = { ...TOKEN, VERCEL_AUTOMATION_BYPASS_SECRET: "bypass-value" }
    expect(
      parseProbeArgs(["--url", "https://naba-abc.vercel.app"], env).bypass
    ).toBe("bypass-value")
    expect(parseProbeArgs(["--url", "http://localhost:3000"], env).bypass).toBe(
      null
    )
    expect(
      parseProbeArgs(["--url", "https://naba-abc.vercel.app"], TOKEN).bypass
    ).toBe(null)
  })

  it("refuses to send the token over plain http off localhost", () => {
    expect(() =>
      parseProbeArgs(["--url", "http://app.example.com"], TOKEN)
    ).toThrow(UsageError)
    expect(() =>
      parseProbeArgs(["--url", "http://127.0.0.1:3100"], TOKEN)
    ).not.toThrow()
  })

  it("rejects a missing token, a short SHA and conflicting expectations", () => {
    expect(() => parseProbeArgs(["--url", "https://a.example"], {})).toThrow(
      "READINESS_PROBE_TOKEN"
    )
    expect(() =>
      parseProbeArgs(
        ["--url", "https://a.example", "--expect-sha", SHA.slice(0, 12)],
        TOKEN
      )
    ).toThrow("full lowercase")
    expect(() =>
      parseProbeArgs(
        [
          "--url",
          "https://a.example",
          "--expect-sha",
          SHA,
          "--expect-promoted",
        ],
        TOKEN
      )
    ).toThrow("not both")
  })
})

describe("readiness probe usage errors", () => {
  it("treats an unknown flag or a stray argument as usage, not a crash", () => {
    expect(() =>
      parseProbeArgs(["--url", "https://a.example", "--bogus"], TOKEN)
    ).toThrow(UsageError)
    expect(() =>
      parseProbeArgs(["--url", "https://a.example", "extra"], TOKEN)
    ).toThrow(UsageError)
  })

  it("accepts the `--` pnpm passes through", () => {
    expect(
      parseProbeArgs(["--", "--url", "https://a.example"], TOKEN).url
    ).toBe("https://a.example/api/operations/readiness")
  })

  it("exits 64 for an unknown flag, distinct from degraded (1)", () => {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/ops/readiness-probe.mjs",
        "--url",
        "http://localhost:1",
        "--bogus",
      ],
      { env: { ...process.env, ...TOKEN }, encoding: "utf8" }
    )
    expect(result.status).toBe(EXIT.usage)
    expect(result.stderr).toContain("readiness-probe:")
  })
})

describe("readiness probe verdict", () => {
  const judge = (input: Partial<Parameters<typeof judgeReadiness>[0]> = {}) =>
    judgeReadiness({
      httpStatus: 200,
      body: body("ready"),
      expectSha: null,
      failOnDegraded: false,
      ...input,
    })

  it("passes a ready deployment and a degraded one unless asked not to", () => {
    expect(judge().exitCode).toBe(EXIT.ok)
    const degraded = body("degraded", {
      reasons: [
        { code: "email_not_configured", severity: "degraded", subject: null },
      ],
    })
    expect(judge({ body: degraded }).exitCode).toBe(EXIT.ok)
    const strict = judge({ body: degraded, failOnDegraded: true })
    expect(strict.exitCode).toBe(EXIT.degraded)
    expect(strict.lines.join("\n")).toContain("email_not_configured")
  })

  it("fails not ready, naming the reason", () => {
    const verdict = judge({
      httpStatus: 503,
      body: body("not_ready", {
        reasons: [
          { code: "tick_stale", severity: "not_ready", subject: "health" },
        ],
      }),
    })
    expect(verdict.exitCode).toBe(EXIT.notReady)
    expect(verdict.lines.join("\n")).toContain("tick_stale (health)")
  })

  it("fails an unreachable, unauthorised or unreadable answer", () => {
    expect(
      judge({ httpStatus: null, body: null, error: "ECONNREFUSED" })
    ).toMatchObject({ exitCode: EXIT.notReady, status: "unreachable" })
    expect(judge({ httpStatus: 401, body: null })).toMatchObject({
      exitCode: EXIT.notReady,
      status: "unauthorised",
    })
    expect(judge({ httpStatus: 500, body: { error: "x" } })).toMatchObject({
      exitCode: EXIT.notReady,
      status: "unreadable",
    })
    // A login page or proxy answer with 200 is not a readiness answer.
    expect(judge({ httpStatus: 200, body: null }).status).toBe("unreadable")
  })

  it("fails when the deployment serves another commit than expected", () => {
    expect(judge({ expectSha: SHA }).exitCode).toBe(EXIT.ok)
    expect(judge({ expectSha: OTHER })).toMatchObject({
      exitCode: EXIT.notReady,
      status: "release_mismatch",
    })
  })
})

describe("promotedSha", () => {
  it("reads the newest promotion receipt and ignores local copies", () => {
    const dir = mkdtempSync(join(tmpdir(), "readiness-probe-"))
    try {
      writeFileSync(
        join(dir, "20261001T000000Z-89abcdef0123.json"),
        JSON.stringify({ sha: OTHER })
      )
      writeFileSync(
        join(dir, "20261009T000000Z-0123456789ab.json"),
        JSON.stringify({ sha: SHA })
      )
      writeFileSync(
        join(dir, "20261009T000000Z-0123456789ab.local.json"),
        JSON.stringify({ sha: OTHER })
      )
      expect(promotedSha(dir)).toBe(SHA)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("is a usage error when nothing has been promoted", () => {
    const dir = mkdtempSync(join(tmpdir(), "readiness-probe-"))
    try {
      expect(() => promotedSha(dir)).toThrow(UsageError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
