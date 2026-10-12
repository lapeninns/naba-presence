// Usage:
//   READINESS_PROBE_TOKEN=... node scripts/ops/readiness-probe.mjs \
//     --url https://app.example.com [--expect-sha <40-hex> | --expect-promoted] \
//     [--fail-on-degraded] [--notify] [--json] [--timeout-ms 15000]
//   pnpm ops:readiness --url ... (same flags; a leading `--` is ignored)
//
// The external half of readiness (docs/observability.md, "Readiness"): asks
// GET /api/operations/readiness and exits non-zero when the deployment is not
// ready, so whatever runs it (by hand, cron, or a launchd agent on an
// operator's machine) is the alert. It is the signal for what the in-app
// health tick cannot report: its own absence, a paused notifications scope,
// an unconfigured email provider, an alert that was never delivered.
//
// The token is the deployment's CRON_SECRET (the endpoint reuses the cron
// bearer), read from READINESS_PROBE_TOKEN or else CRON_SECRET in this
// process's environment. The script never reads .env files and never prints
// the token. `--url` falls back to READINESS_URL.
//
// `--expect-sha` fails unless the deployment reports that commit;
// `--expect-promoted` takes it from the newest promotion receipt in
// docs/release/receipts/ (pnpm release:promote), so a probe after a promotion
// confirms production is serving what was promoted.
//
// Exit codes: 0 ready (or degraded without --fail-on-degraded), 1 degraded
// with --fail-on-degraded, 2 not ready, unreachable, unauthorised, an
// unreadable answer or a SHA mismatch, 64 usage error. `--notify` also raises
// a macOS notification (osascript) on any non-zero result.

import { execFile } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

import {
  latestPromotedRelease,
  PROMOTION_RECEIPTS_DIR,
} from "../release/local-receipt.mjs"

export const EXIT = { ok: 0, degraded: 1, notReady: 2, usage: 64 }

const SHA_PATTERN = /^[0-9a-f]{40}$/

export class UsageError extends Error {}

const PROBE_OPTIONS = {
  url: { type: "string" },
  "expect-sha": { type: "string" },
  "expect-promoted": { type: "boolean", default: false },
  "fail-on-degraded": { type: "boolean", default: false },
  notify: { type: "boolean", default: false },
  json: { type: "boolean", default: false },
  "timeout-ms": { type: "string", default: "15000" },
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export function parseProbeArgs(argv, env) {
  // `pnpm ops:readiness -- --url ...` passes the `--` through.
  const args = argv[0] === "--" ? argv.slice(1) : argv
  let values
  try {
    ;({ values } = parseArgs({ args, options: PROBE_OPTIONS }))
  } catch (error) {
    // An unknown flag or a stray argument is a usage error (64), not a
    // crash: exit 1 is the probe's "degraded".
    if (String(error?.code ?? "").startsWith("ERR_PARSE_ARGS")) {
      throw new UsageError(error.message)
    }
    throw error
  }
  const base = values.url ?? env.READINESS_URL
  if (!base) throw new UsageError("--url (or READINESS_URL) is required")
  let url
  try {
    url = new URL("/api/operations/readiness", base)
  } catch {
    throw new UsageError("--url is not a valid URL")
  }
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    // The bearer token must not cross the network in the clear.
    throw new UsageError("--url must be https (http only for localhost)")
  }
  const token = env.READINESS_PROBE_TOKEN || env.CRON_SECRET
  if (!token) {
    throw new UsageError("set READINESS_PROBE_TOKEN (or CRON_SECRET)")
  }
  const expectSha = values["expect-sha"]
  if (expectSha !== undefined && !SHA_PATTERN.test(expectSha)) {
    throw new UsageError("--expect-sha must be a full lowercase commit SHA")
  }
  if (expectSha && values["expect-promoted"]) {
    throw new UsageError("use --expect-sha or --expect-promoted, not both")
  }
  const timeoutMs = Number(values["timeout-ms"])
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000) {
    throw new UsageError("--timeout-ms must be an integer of at least 1000")
  }
  return {
    url: url.toString(),
    token,
    expectSha: expectSha ?? null,
    expectPromoted: values["expect-promoted"],
    failOnDegraded: values["fail-on-degraded"],
    notify: values.notify,
    json: values.json,
    timeoutMs,
  }
}

/**
 * The verdict on one answer. `httpStatus` null is no answer at all (a
 * network error or timeout, `error` says which).
 *
 * @param {{
 *   httpStatus: number | null,
 *   body: unknown,
 *   error?: string,
 *   expectSha: string | null,
 *   failOnDegraded: boolean,
 * }} input
 * @returns {{ exitCode: number, status: string, lines: string[] }}
 */
export function judgeReadiness({
  httpStatus,
  body,
  error,
  expectSha,
  failOnDegraded,
}) {
  if (httpStatus === null) {
    return {
      exitCode: EXIT.notReady,
      status: "unreachable",
      lines: [`readiness: unreachable (${error ?? "no response"})`],
    }
  }
  if (httpStatus === 401) {
    return {
      exitCode: EXIT.notReady,
      status: "unauthorised",
      lines: ["readiness: 401, the token is not this deployment's CRON_SECRET"],
    }
  }
  const status =
    body && typeof body === "object" && "status" in body
      ? String(body.status)
      : null
  if (
    !status ||
    !["ready", "degraded", "not_ready"].includes(status) ||
    (httpStatus !== 200 && httpStatus !== 503)
  ) {
    return {
      exitCode: EXIT.notReady,
      status: "unreadable",
      lines: [`readiness: unexpected answer (HTTP ${httpStatus})`],
    }
  }
  const reasons = Array.isArray(body.reasons) ? body.reasons : []
  const sha =
    body.release && typeof body.release === "object"
      ? String(body.release.sha ?? "unknown")
      : "unknown"
  const lines = [`readiness: ${status} (HTTP ${httpStatus}) release ${sha}`]
  for (const reason of reasons) {
    lines.push(
      `  ${reason.severity === "not_ready" ? "NOT READY" : "degraded "} ${reason.code}${reason.subject ? ` (${reason.subject})` : ""}`
    )
  }
  let exitCode =
    status === "not_ready" || httpStatus === 503
      ? EXIT.notReady
      : status === "degraded" && failOnDegraded
        ? EXIT.degraded
        : EXIT.ok
  let verdict = status
  if (expectSha && sha !== expectSha) {
    lines.push(`  NOT READY release_mismatch (expected ${expectSha})`)
    exitCode = EXIT.notReady
    verdict = "release_mismatch"
  }
  return { exitCode, status: verdict, lines }
}

/** The newest promoted SHA in `dir`, or a UsageError when there is none. */
export function promotedSha(dir) {
  let names
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json"))
  } catch {
    throw new UsageError(`cannot read ${dir}`)
  }
  const latest = latestPromotedRelease(
    names.map((name) => ({
      name,
      content: readFileSync(join(dir, name), "utf8"),
    }))
  )
  if (!latest) throw new UsageError(`no promotion receipt in ${dir}`)
  return latest.sha
}

async function ask(options) {
  try {
    const response = await fetch(options.url, {
      headers: { authorization: `Bearer ${options.token}` },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs),
    })
    const body = await response.json().catch(() => null)
    return { httpStatus: response.status, body }
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error"
    // fetch wraps the socket error; an AggregateError (several addresses
    // tried) carries the codes on its members.
    const cause =
      error && typeof error === "object" && "cause" in error
        ? error.cause
        : undefined
    const code = cause?.code ?? cause?.errors?.[0]?.code
    return { httpStatus: null, body: null, error: code ?? name }
  }
}

function notify(message) {
  if (process.platform !== "darwin") return Promise.resolve()
  const script = `display notification ${JSON.stringify(message)} with title "NabaPresence readiness"`
  return new Promise((resolve) => {
    execFile("osascript", ["-e", script], () => resolve())
  })
}

async function main() {
  let options
  try {
    options = parseProbeArgs(process.argv.slice(2), process.env)
    if (options.expectPromoted) {
      const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
      options.expectSha = promotedSha(join(root, PROMOTION_RECEIPTS_DIR))
    }
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`readiness-probe: ${error.message}`)
      return EXIT.usage
    }
    throw error
  }
  const answer = await ask(options)
  const verdict = judgeReadiness({ ...answer, ...options })
  if (options.json) {
    console.log(
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        url: options.url,
        exitCode: verdict.exitCode,
        status: verdict.status,
        httpStatus: answer.httpStatus,
        body: answer.body,
      })
    )
  } else {
    const write = verdict.exitCode === EXIT.ok ? console.log : console.error
    for (const line of verdict.lines) write(line)
  }
  if (options.notify && verdict.exitCode !== EXIT.ok) {
    await notify(verdict.lines.slice(0, 3).join(" / "))
  }
  return verdict.exitCode
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main()
}
