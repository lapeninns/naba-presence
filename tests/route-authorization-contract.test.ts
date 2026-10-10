import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * Route visibility never authorises a mutation (ledger PERM-02).
 *
 * Every session-authenticated POST/PUT/PATCH/DELETE under app/api must do one
 * of three things, and this static scan proves which:
 *   1. declare `roles` on route(), so the organisation role is gated before
 *      the handler runs;
 *   2. call an action guard in the route file itself; or
 *   3. delegate to a lib module that calls one, named in DELEGATED below so
 *      the claim is checked against that module's source.
 * The few session mutations with no location at all are listed in
 * NO_LOCATION with the reason. A new handler that does none of these fails
 * here, and so does a stale allowlist entry.
 */

const repoRoot = fileURLToPath(new URL("../", import.meta.url))

/** A call that decides an action, not merely visibility. */
const ACTION_GUARD =
  /\b(requireLocationAction|requirePublishGrant|canPublishLocation)\(/

const DELEGATED: Record<string, readonly string[]> = {
  "POST app/api/locations/[id]/food-menus/route.ts": [
    "lib/server/food-menus.ts",
  ],
  "POST app/api/locations/[id]/hours/route.ts": ["lib/server/hours.ts"],
  "POST app/api/locations/[id]/media/route.ts": ["lib/server/media.ts"],
  "PATCH app/api/locations/[id]/media/[mediaId]/route.ts": [
    "lib/server/media.ts",
  ],
  "DELETE app/api/locations/[id]/media/[mediaId]/route.ts": [
    "lib/server/media.ts",
  ],
  "POST app/api/locations/[id]/place-actions/route.ts": [
    "lib/server/place-actions.ts",
  ],
  "PATCH app/api/locations/[id]/place-actions/[linkId]/route.ts": [
    "lib/server/place-actions.ts",
  ],
  "DELETE app/api/locations/[id]/place-actions/[linkId]/route.ts": [
    "lib/server/place-actions.ts",
  ],
  "POST app/api/locations/[id]/posts/route.ts": ["lib/server/posts.ts"],
  "PATCH app/api/locations/[id]/posts/[postId]/route.ts": [
    "lib/server/posts.ts",
  ],
  "DELETE app/api/locations/[id]/posts/[postId]/route.ts": [
    "lib/server/posts.ts",
  ],
  "POST app/api/locations/[id]/posts/[postId]/publish/route.ts": [
    "lib/server/posts.ts",
  ],
  "POST app/api/reviews/[id]/approval/route.ts": [
    "lib/server/review-approval.ts",
  ],
  "POST app/api/reviews/[id]/publish/route.ts": [
    "lib/server/publishing/intent.ts",
  ],
  "DELETE app/api/reviews/[id]/reply/route.ts": [
    "lib/server/publishing/delete.ts",
  ],
}

const NO_LOCATION: Record<string, string> = {
  "POST app/api/invitations/[token]/route.ts":
    "accepts an invitation addressed to the signed-in user; no location",
  "POST app/api/session/switch/route.ts":
    "switches the caller's own active organisation; membership is checked",
  "DELETE app/api/support/impersonation/route.ts":
    "ends the caller's own support session",
}

type Handler = { key: string; file: string; source: string; config: string }

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return routeFiles(path)
    return entry.name === "route.ts" ? [path] : []
  })
}

function sessionMutations(): Handler[] {
  const handlers: Handler[] = []
  for (const path of routeFiles(join(repoRoot, "app/api"))) {
    const file = relative(repoRoot, path).split("\\").join("/")
    const source = readFileSync(path, "utf8")
    const exports = [
      ...source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\s*=/g),
    ]
    exports.forEach((match, index) => {
      const method = match[1]
      if (method === "GET") return
      const end = exports[index + 1]?.index ?? source.length
      const config = source.slice(match.index, end)
      const auth = /auth:\s*"(\w+)"/.exec(config)?.[1] ?? "session"
      if (auth !== "session") return
      handlers.push({ key: `${method} ${file}`, file, source, config })
    })
  }
  return handlers
}

describe("route authorisation contract", () => {
  const handlers = sessionMutations()

  it("finds the session mutations it is meant to police", () => {
    expect(handlers.length).toBeGreaterThan(40)
  })

  it("never exports a raw mutation handler that bypasses route()", () => {
    const raw = routeFiles(join(repoRoot, "app/api")).filter((path) =>
      /export (async )?function (POST|PUT|PATCH|DELETE)\b/.test(
        readFileSync(path, "utf8")
      )
    )
    expect(raw).toEqual([])
  })

  it.each(handlers.map((handler) => [handler.key, handler] as const))(
    "%s declares roles or reaches an action guard",
    (_key, handler) => {
      if (/\broles:/.test(handler.config)) return
      if (ACTION_GUARD.test(handler.source)) return
      const via = DELEGATED[handler.key]
      if (via) {
        for (const libFile of via) {
          const source = readFileSync(join(repoRoot, libFile), "utf8")
          expect(
            ACTION_GUARD.test(source),
            `${libFile} has no action guard`
          ).toBe(true)
        }
        return
      }
      expect(
        NO_LOCATION[handler.key],
        `${handler.key}: declare roles, call requireLocationAction, or list it here`
      ).toBeTruthy()
    }
  )

  it("keeps no stale allowlist entries", () => {
    const keys = new Set(
      handlers
        .filter(
          (handler) =>
            !/\broles:/.test(handler.config) &&
            !ACTION_GUARD.test(handler.source)
        )
        .map((handler) => handler.key)
    )
    const stale = [
      ...Object.keys(DELEGATED),
      ...Object.keys(NO_LOCATION),
    ].filter((key) => !keys.has(key))
    expect(stale).toEqual([])
  })
})
