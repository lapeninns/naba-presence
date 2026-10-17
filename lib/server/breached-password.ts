import "server-only"

import { createHash } from "node:crypto"
import { request } from "node:https"

import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"

// NIST SP 800-63B-4 asks that a new password be checked against passwords
// known from breaches. Pwned Passwords answers through a k-anonymity range
// API: we send the first five hex characters of the password's SHA-1 and get
// back every suffix that shares them, so neither the password nor its full
// hash leaves the server, and the match happens here.
const RANGE_HOST = "api.pwnedpasswords.com"
const RANGE_PATH = "/range/"
const PREFIX_LENGTH = 5

/** A padded answer is about 40 KB; anything far larger is not a range. */
const MAX_BODY_CHARS = 1_000_000

/** One record: the other 35 hex characters of a SHA-1, a colon, a count. */
const RANGE_RECORD = /^([0-9A-F]{35}):(\d+)$/

/**
 * The API asks every caller to identify itself and may answer 403 to a
 * missing or generic User-Agent. A 403 would take the fail-open path on every
 * check and let breached passwords through, so this stays fixed and explicit.
 */
export const BREACHED_PASSWORD_USER_AGENT = "NabaPresence-PasswordCheck"

/**
 * Short on purpose: the check sits in front of sign-up and reset, and fails
 * open, so a slow service costs the person this long and no more.
 */
export const BREACHED_PASSWORD_TIMEOUT_MS = 2_500

export const BREACHED_PASSWORD_MESSAGE =
  "This password has appeared in a known data breach, so it is easy to guess. Choose a different one."

export type BreachedPasswordResult = "breached" | "not_breached" | "unavailable"

/**
 * Whether the password is in Pwned Passwords. `unavailable` when the service
 * could not answer (network error, timeout, non-2xx) or answered with
 * something that is not a range: the caller fails open, and the warning shows
 * the check is degraded.
 *
 * The request carries `Add-Padding: true`, so every response is padded to a
 * similar size with fake suffixes whose count is 0. A count of 0 is padding,
 * never a hit.
 */
export async function checkBreachedPassword(
  password: string
): Promise<BreachedPasswordResult> {
  const hash = createHash("sha1")
    .update(password, "utf8")
    .digest("hex")
    .toUpperCase()
  const prefix = hash.slice(0, PREFIX_LENGTH)
  const suffix = hash.slice(PREFIX_LENGTH)
  let body: string
  try {
    body = await requestRange(prefix)
  } catch {
    return unavailable()
  }
  let records = 0
  let result: BreachedPasswordResult = "not_breached"
  for (const line of body.split("\n")) {
    const trimmed = line.trim()
    if (trimmed === "") continue
    const record = RANGE_RECORD.exec(trimmed.toUpperCase())
    // A proxy page, an HTML error or a truncated body is not an answer.
    if (!record) return unavailable()
    records += 1
    if (record[1] === suffix && Number.parseInt(record[2], 10) > 0) {
      result = "breached"
    }
  }
  return records === 0 ? unavailable() : result
}

/**
 * GETs the range for one prefix and resolves with the body; rejects on a
 * network error, a non-2xx answer, an oversized body or the timeout, which
 * covers reading the body too.
 *
 * This uses node:https, not fetch, on purpose. Next.js wraps the global fetch
 * and names its span `fetch GET <url>` with the full URL in `http.url`, and
 * `opentelemetry: { ignore: true }` does not stop it, so with a trace exporter
 * configured the prefix would leave the server in telemetry and could be
 * matched to the sign-up or reset request. Neither Next.js nor @vercel/otel
 * (instrumentation.ts registers only its fetch instrumentation) traces
 * node:https. tests/server/breached-password-telemetry.test.ts holds this.
 */
function requestRange(prefix: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (error: Error | null, body = "") => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        req.destroy()
        reject(error)
      } else {
        resolve(body)
      }
    }
    const req = request(
      {
        host: RANGE_HOST,
        path: `${RANGE_PATH}${prefix}`,
        method: "GET",
        headers: {
          "Add-Padding": "true",
          "User-Agent": BREACHED_PASSWORD_USER_AGENT,
        },
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status < 200 || status > 299) {
          res.resume()
          settle(new Error("range request failed"))
          return
        }
        let body = ""
        res.setEncoding("utf8")
        res.on("data", (chunk: string) => {
          body += chunk
          if (body.length > MAX_BODY_CHARS) settle(new Error("range too large"))
        })
        res.on("end", () => settle(null, body))
        res.on("error", (error) => settle(error))
        // Fires after "end" on a complete body, when it is a no-op.
        res.on("close", () => settle(new Error("range body cut short")))
      }
    )
    // Declared after `settle`, which only ever runs later, from a callback.
    const timer = setTimeout(
      () => settle(new Error("range request timed out")),
      BREACHED_PASSWORD_TIMEOUT_MS
    )
    req.on("error", (error) => settle(error))
    req.end()
  })
}

function unavailable(): "unavailable" {
  // Nothing derived from the password (not even the prefix) is logged.
  log.warn("auth.breached_password_check_unavailable")
  return "unavailable"
}

/**
 * Refuses a new password found in a breach, as the field error the sign-up
 * and reset forms already show for an invalid password. Off only when
 * `BREACHED_PASSWORD_CHECK_ENABLED` is false (unset means on) or password
 * auth is off. Existing passwords are never checked: sign-in does not call
 * this.
 */
export async function assertPasswordNotBreached(
  password: string
): Promise<void> {
  const env = getServerEnv()
  // With password auth off the route answers 503 from the provider call
  // anyway, so there is nothing to check a password for.
  if (!env.PASSWORD_AUTH_ENABLED || !env.BREACHED_PASSWORD_CHECK_ENABLED) return
  if ((await checkBreachedPassword(password)) !== "breached") return
  throw new ApiError(
    400,
    "invalid_request",
    "The request did not pass validation.",
    {
      fieldErrors: { password: BREACHED_PASSWORD_MESSAGE },
      details: [
        {
          code: "password_breached",
          path: ["password"],
          message: BREACHED_PASSWORD_MESSAGE,
        },
      ],
    }
  )
}
