import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * Route visibility never authorises a mutation (ledger PERM-02).
 *
 * Every session-authenticated POST/PUT/PATCH/DELETE under app/api must do one
 * of three things, and this static scan proves which:
 *   1. declare `roles` on route() (never including "viewer"), so the
 *      organisation role is gated before the handler runs;
 *   2. call an action guard inside that handler's own route() config (not
 *      merely somewhere in the file, where a GET's guard would hide it); or
 *   3. delegate to named lib functions, listed in DELEGATED below as call
 *      chains. The handler must call each chain's first function, each link
 *      must call the next, and the last must call a guard, so dropping the
 *      guard from one function (say createLocalPostDraft) fails here even
 *      though the module still guards others.
 * The few session mutations with no location at all are listed in
 * NO_LOCATION with the reason, and handlers that only refuse (the write
 * moved to a reviewed route) in REFUSES, whose shape is checked. A new handler that does none of these fails
 * here, and so does a stale allowlist entry.
 *
 * A static scan proves a guard call is present, not that it is the right
 * action. The behaviour of the delegated post, reply and bulk paths is pinned
 * by the integration tests tests/integration/routes/viewer-read-only.test.ts,
 * tests/integration/routes/post-approval-access.test.ts and
 * tests/integration/routes/review-bulk.test.ts.
 */

const repoRoot = fileURLToPath(new URL("../", import.meta.url))

/**
 * A call that enforces an action, not merely visibility. canPublishLocation
 * answers a boolean, so it only counts in its refusing form.
 */
const ACTION_GUARD =
  /\b(requireLocationAction|requireLocationActionForAll|requirePublishGrant)\(|if \(!\(await canPublishLocation\(/

/**
 * "module#function" links, from the function the route calls to the guard.
 * A first link "registry:<kind>" is a listing write routed through
 * submitListingChange (lib/server/listing-change-registry.ts): the handler
 * must submit that kind, and the kind's registry entry must call the next
 * link -- the surface function a parked request is dispatched through too.
 */
type Chain = readonly string[]

const REGISTRY = "lib/server/listing-change-registry.ts"

/** The source of one kind's entry in the listing change registry. */
function registryEntry(kind: string): string {
  const source = readFileSync(join(repoRoot, REGISTRY), "utf8")
  const start = source.indexOf(`\n  ${kind}: entry({`)
  if (start === -1) throw new Error(`${REGISTRY} has no entry ${kind}`)
  const rest = source.slice(start + 1)
  const close = rest.indexOf("\n  }),\n")
  return close === -1 ? rest : rest.slice(0, close)
}

const DELEGATED: Record<string, readonly Chain[]> = {
  "POST app/api/locations/[id]/food-menus/route.ts": [
    [
      "registry:food_menus_publish",
      "lib/server/food-menus.ts#publishFoodMenus",
      "lib/server/food-menus.ts#assertFoodMenusPublishable",
    ],
  ],
  "POST app/api/locations/[id]/hours/route.ts": [
    ["registry:hours_publish", "lib/server/hours.ts#publishCanonicalHours"],
  ],
  "POST app/api/locations/[id]/media/route.ts": [
    [
      "lib/server/media.ts#uploadMedia",
      "lib/server/media.ts#linkedForWrite",
      "lib/server/media.ts#requireMediaWrite",
    ],
    [
      "registry:media_create",
      "lib/server/media.ts#createMedia",
      "lib/server/media.ts#linkedForWrite",
      "lib/server/media.ts#requireMediaWrite",
    ],
  ],
  "POST app/api/locations/[id]/media/resolutions/[attemptId]/route.ts": [
    ["lib/server/media.ts#resolveMediaCreate"],
  ],
  "PATCH app/api/locations/[id]/media/[mediaId]/route.ts": [
    [
      "registry:media_update",
      "lib/server/media.ts#updateMedia",
      "lib/server/media.ts#mutableMediaItem",
      "lib/server/media.ts#linkedForWrite",
      "lib/server/media.ts#requireMediaWrite",
    ],
  ],
  "DELETE app/api/locations/[id]/media/[mediaId]/route.ts": [
    [
      "registry:media_delete",
      "lib/server/media.ts#removeMedia",
      "lib/server/media.ts#mutableMediaItem",
      "lib/server/media.ts#linkedForWrite",
      "lib/server/media.ts#requireMediaWrite",
    ],
  ],
  "POST app/api/locations/[id]/post-schedules/route.ts": [
    ["lib/server/publication-schedules.ts#createPublicationSchedule"],
  ],
  "PUT app/api/locations/[id]/post-schedules/[scheduleId]/route.ts": [
    ["lib/server/publication-schedules.ts#revisePublicationSchedule"],
  ],
  "POST app/api/listings/bulk/preview/route.ts": [
    ["lib/server/bulk-listings.ts#previewBulkOperation"],
  ],
  // Approving dispatches the frozen write through its surface function,
  // whose own guard (the chains above) runs again as the approver.
  "POST app/api/locations/[id]/change-requests/[changeId]/route.ts": [
    [
      "lib/server/listing-change-registry.ts#decideListingChange",
      "lib/server/listing-changes.ts#rejectListingChange",
      "lib/server/listing-changes.ts#lockPending",
    ],
    [
      "lib/server/listing-change-registry.ts#decideListingChange",
      "lib/server/listing-changes.ts#approveListingChange",
      "lib/server/listing-changes.ts#lockPending",
    ],
  ],
  "POST app/api/locations/[id]/posts/route.ts": [
    ["lib/server/posts.ts#createLocalPostDraft"],
  ],
  "PATCH app/api/locations/[id]/posts/[postId]/route.ts": [
    ["lib/server/posts.ts#updateLocalPostDraft"],
    ["lib/server/posts.ts#requestOrPublishLocalPost"],
  ],
  "DELETE app/api/locations/[id]/posts/[postId]/route.ts": [
    ["lib/server/posts.ts#deleteLocalPost"],
  ],
  "POST app/api/locations/[id]/posts/[postId]/publish/route.ts": [
    ["lib/server/posts.ts#requestOrPublishLocalPost"],
  ],
  "POST app/api/locations/[id]/posts/[postId]/approval/route.ts": [
    ["lib/server/posts.ts#rejectLocalPost"],
    ["lib/server/posts.ts#requestOrPublishLocalPost"],
  ],
  "POST app/api/reviews/[id]/approval/route.ts": [
    ["lib/server/review-approval.ts#recordApprovalDecision"],
    [
      "lib/server/review-approval.ts#completeApproval",
      "lib/server/publishing/publish.ts#executePublish",
      "lib/server/publishing/intent.ts#preparePublish",
    ],
  ],
  "POST app/api/reviews/[id]/publish/route.ts": [
    [
      "lib/server/publishing/publish.ts#executePublish",
      "lib/server/publishing/intent.ts#preparePublish",
    ],
  ],
  "DELETE app/api/reviews/[id]/reply/route.ts": [
    [
      "lib/server/publishing/delete.ts#executeReplyDelete",
      "lib/server/publishing/delete.ts#prepareDelete",
    ],
  ],
}

/** Calls `name(` (or `await name(`) in `source`. */
function calls(source: string, name: string): boolean {
  return new RegExp(`\\b${name}\\(`).test(source)
}

/**
 * The source of one top-level function in a module: from its last
 * `function name(` (the implementation, after any overload signatures) to
 * the first closing brace at column zero.
 */
function functionBody(module: string, name: string): string {
  const source = readFileSync(join(repoRoot, module), "utf8")
  const starts = [
    ...source.matchAll(
      new RegExp(`^(?:export )?(?:async )?function ${name}\\b`, "gm")
    ),
  ]
  const start = starts.at(-1)?.index
  if (start === undefined) throw new Error(`${module} has no function ${name}`)
  const rest = source.slice(start)
  const close = rest.search(/\n\}\n/)
  return close === -1 ? rest : rest.slice(0, close + 2)
}

/** Why `chain` does not prove a guard for `config`, or null when it does. */
function chainGap(config: string, chain: Chain): string | null {
  if (chain[0]?.startsWith("registry:")) {
    const kind = chain[0].slice("registry:".length)
    if (
      !calls(config, "submitListingChange") ||
      !config.includes(`"${kind}"`)
    ) {
      return `the handler does not submit ${kind}`
    }
    const next = chain[1]?.split("#")[1]
    if (!next || !calls(registryEntry(kind), next)) {
      return `the ${kind} registry entry does not call ${next}`
    }
    return chainGap(
      config.replace(/\bsubmitListingChange\(/g, `${next}(`),
      chain.slice(1)
    )
  }
  const links = chain.map((link) => {
    const [module, name] = link.split("#")
    return { link, module: module!, name: name! }
  })
  if (!calls(config, links[0]!.name)) {
    return `the handler does not call ${links[0]!.name}`
  }
  for (const [index, current] of links.entries()) {
    const body = functionBody(current.module, current.name)
    const next = links[index + 1]
    if (next) {
      if (!calls(body, next.name))
        return `${current.link} does not call ${next.name}`
    } else if (!ACTION_GUARD.test(body)) {
      return `${current.link} has no action guard`
    }
  }
  return null
}

/** `roles: [...]` on route(), when it excludes viewers. */
function declaresNonViewerRoles(config: string): boolean {
  const roles = /\broles:\s*\[([^\]]*)\]/.exec(config)?.[1]
  return roles !== undefined && !/["']viewer["']/.test(roles)
}

const NO_LOCATION: Record<string, string> = {
  "POST app/api/invitations/[token]/route.ts":
    "accepts an invitation addressed to the signed-in user; no location",
  "POST app/api/session/switch/route.ts":
    "switches the caller's own active organisation; membership is checked",
  "DELETE app/api/support/impersonation/route.ts":
    "ends the caller's own support session",
  "POST app/api/notifications/read/route.ts":
    "the caller's own read state, only for incidents they can already see",
  "PUT app/api/notifications/preferences/route.ts":
    "the caller's own notification preferences",
}

/**
 * Handlers kept only to refuse: the write moved behind a reviewed change set
 * (an owner or admin's exact, approved request), and the handler throws
 * before reading anything. Checked by shape, not just listed.
 */
const REFUSES: Record<string, string> = {
  "POST app/api/locations/[id]/place-actions/route.ts":
    "place action links are written through reviewed change sets",
  "PATCH app/api/locations/[id]/place-actions/[linkId]/route.ts":
    "place action links are written through reviewed change sets",
  "DELETE app/api/locations/[id]/place-actions/[linkId]/route.ts":
    "place action links are written through reviewed change sets",
}

/** The handler takes nothing and its whole body is one `throw new ApiError(`. */
function onlyRefuses(config: string): boolean {
  return /\bhandler:\s*\(\)\s*=>\s*\{\s*throw new ApiError\([^;{}]*\)\s*\}/.test(
    config
  )
}

type Handler = { key: string; file: string; config: string }

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
      handlers.push({ key: `${method} ${file}`, file, config })
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

  it("never lets a roles declaration include viewers", () => {
    const loose = handlers
      .filter((handler) => /\broles:/.test(handler.config))
      .filter((handler) => !declaresNonViewerRoles(handler.config))
      .map((handler) => handler.key)
    expect(loose).toEqual([])
  })

  it.each(handlers.map((handler) => [handler.key, handler] as const))(
    "%s declares roles or reaches an action guard",
    (_key, handler) => {
      if (declaresNonViewerRoles(handler.config)) return
      if (ACTION_GUARD.test(handler.config)) return
      if (REFUSES[handler.key]) {
        expect(onlyRefuses(handler.config), handler.key).toBe(true)
        return
      }
      const chains = DELEGATED[handler.key]
      if (chains) {
        for (const chain of chains) {
          expect(chainGap(handler.config, chain), chain.join(" -> ")).toBeNull()
        }
        return
      }
      expect(
        NO_LOCATION[handler.key],
        `${handler.key}: declare roles, call requireLocationAction, or list it here`
      ).toBeTruthy()
    }
  )

  // The checker itself: each regression the contract exists to catch must
  // be caught, so a loosened matcher cannot pass silently.
  it("catches a guard removed from one function of a guarded module", () => {
    const body = functionBody("lib/server/posts.ts", "createLocalPostDraft")
    expect(ACTION_GUARD.test(body)).toBe(true)
    expect(
      ACTION_GUARD.test(body.replace(/requireLocationAction\(/g, "noop("))
    ).toBe(false)
  })

  it("does not count a boolean permission read or a viewer role list", () => {
    expect(
      ACTION_GUARD.test("const ok = await canPublishLocation(sql, s, id)")
    ).toBe(false)
    expect(declaresNonViewerRoles('roles: ["owner", "viewer"],')).toBe(false)
    expect(declaresNonViewerRoles('roles: ["owner", "admin"],')).toBe(true)
  })

  it("does not take a handler that reads its input as a refusal", () => {
    expect(
      onlyRefuses(
        'handler: () => { throw new ApiError(409, "x", "Use the review.") },'
      )
    ).toBe(true)
    expect(
      onlyRefuses(
        "handler: async ({ session }) => { throw new ApiError(409, session.userId) },"
      )
    ).toBe(false)
    expect(
      onlyRefuses(
        'handler: () => { await write(); throw new ApiError(409, "x", "y") },'
      )
    ).toBe(false)
  })

  it("reports a handler that does not call its delegated function", () => {
    expect(
      chainGap("export const POST = route({ handler: async () => ok() })", [
        "lib/server/posts.ts#createLocalPostDraft",
      ])
    ).toBe("the handler does not call createLocalPostDraft")
  })

  it("follows a listing write through its registry entry to the surface guard", () => {
    const chain = [
      "registry:media_update",
      "lib/server/media.ts#updateMedia",
      "lib/server/media.ts#mutableMediaItem",
      "lib/server/media.ts#linkedForWrite",
      "lib/server/media.ts#requireMediaWrite",
    ]
    expect(
      chainGap(
        'route({ handler: () => submitListingChange("media_update", {}) })',
        chain
      )
    ).toBeNull()
    expect(
      chainGap(
        'route({ handler: () => submitListingChange("media_create", {}) })',
        chain
      )
    ).toBe("the handler does not submit media_update")
    expect(
      chainGap(
        'route({ handler: () => submitListingChange("media_update", {}) })',
        ["registry:media_update", "lib/server/media.ts#createMedia"]
      )
    ).toBe("the media_update registry entry does not call createMedia")
  })

  it("keeps no stale allowlist entries", () => {
    const keys = new Set(
      handlers
        .filter(
          (handler) =>
            !declaresNonViewerRoles(handler.config) &&
            !ACTION_GUARD.test(handler.config)
        )
        .map((handler) => handler.key)
    )
    const stale = [
      ...Object.keys(DELEGATED),
      ...Object.keys(NO_LOCATION),
      ...Object.keys(REFUSES),
    ].filter((key) => !keys.has(key))
    expect(stale).toEqual([])
  })
})
