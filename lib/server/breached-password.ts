import "server-only"

import { createHash } from "node:crypto"

import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"

// NIST SP 800-63B-4 asks that a new password be checked against passwords
// known from breaches. Pwned Passwords answers through a k-anonymity range
// API: we send the first five hex characters of the password's SHA-1 and get
// back every suffix that shares them, so neither the password nor its full
// hash leaves the server, and the match happens here.
const RANGE_URL = "https://api.pwnedpasswords.com/range/"
const PREFIX_LENGTH = 5

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
 * could not answer (network error, timeout, non-2xx): the caller fails open.
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
    const response = await fetch(`${RANGE_URL}${prefix}`, {
      method: "GET",
      headers: { "Add-Padding": "true" },
      cache: "no-store",
      // Covers reading the body too, not just the headers.
      signal: AbortSignal.timeout(BREACHED_PASSWORD_TIMEOUT_MS),
    })
    if (!response.ok) return unavailable()
    body = await response.text()
  } catch {
    return unavailable()
  }
  for (const line of body.split("\n")) {
    const separator = line.indexOf(":")
    if (separator === -1) continue
    if (line.slice(0, separator).trim().toUpperCase() !== suffix) continue
    return Number.parseInt(line.slice(separator + 1).trim(), 10) > 0
      ? "breached"
      : "not_breached"
  }
  return "not_breached"
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
