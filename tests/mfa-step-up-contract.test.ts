import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * Which handlers demand a recent two-step verification (P02-S9).
 *
 * Owners and admins step up before sensitive team, Google connection,
 * publishing/approval and settings actions; reading, enrollment, exports and
 * invoice viewing stay allowed at aal1. This static scan pins the list: each
 * handler below declares `mfa: "step_up"` in its own route() config, or
 * calls `requireRecentMfa` itself where only part of it is sensitive
 * (IN_HANDLER). A new sensitive handler belongs here; a stale entry fails.
 * Behaviour is covered by tests/server/mfa-step-up.test.ts and
 * tests/integration/routes/mfa-step-up.test.ts.
 *
 * INTEGRATION: billing routes (stream B) declare `mfa: "step_up"` on their
 * mutations and are added here when they land.
 */

const repoRoot = fileURLToPath(new URL("../", import.meta.url))

const STEP_UP: readonly string[] = [
  "POST app/api/members/route.ts",
  "PATCH app/api/members/route.ts",
  "DELETE app/api/members/route.ts",
  "PUT app/api/members/[userId]/client-access/route.ts",
  "POST app/api/clients/[clientId]/locations/route.ts",
  "DELETE app/api/clients/[clientId]/locations/route.ts",
  "POST app/api/invitations/route.ts",
  "POST app/api/google/connect/start/route.ts",
  "POST app/api/google/connections/[id]/disconnect/route.ts",
  "PATCH app/api/google/accounts/route.ts",
  "PATCH app/api/google/notifications/route.ts",
  "POST app/api/location-links/route.ts",
  "DELETE app/api/location-links/route.ts",
  "POST app/api/clients/[clientId]/connections/route.ts",
  "POST app/api/clients/[clientId]/report-shares/route.ts",
  "POST app/api/google/accounts/[accountId]/drafts/[draftId]/creation/route.ts",
  "POST app/api/google/accounts/[accountId]/drafts/[draftId]/creation/link/route.ts",
  "POST app/api/google/accounts/[accountId]/drafts/[draftId]/match-link/route.ts",
  "POST app/api/google/accounts/[accountId]/drafts/[draftId]/reviews/[reviewId]/route.ts",
  "POST app/api/google/accounts/[accountId]/drafts/[draftId]/match-link-reviews/[reviewId]/route.ts",
  "PATCH app/api/locations/[id]/business-information/route.ts",
  "POST app/api/locations/[id]/business-information/route.ts",
  "POST app/api/locations/[id]/hours/route.ts",
  "POST app/api/locations/[id]/food-menus/route.ts",
  "POST app/api/locations/[id]/profile/route.ts",
  "POST app/api/locations/[id]/industry/route.ts",
  "PATCH app/api/locations/[id]/industry/route.ts",
  "POST app/api/locations/[id]/media/route.ts",
  "PATCH app/api/locations/[id]/media/[mediaId]/route.ts",
  "DELETE app/api/locations/[id]/media/[mediaId]/route.ts",
  "POST app/api/locations/[id]/change-requests/[changeId]/route.ts",
  "PATCH app/api/locations/[id]/administration/route.ts",
  "POST app/api/locations/[id]/administration-access-reviews/[reviewId]/route.ts",
  "POST app/api/locations/[id]/administration-access-reviews/[reviewId]/execute/route.ts",
  "PATCH app/api/locations/[id]/administration-access-reviews/[reviewId]/execute/route.ts",
  "POST app/api/locations/[id]/administration-lifecycle-reviews/[reviewId]/route.ts",
  "POST app/api/locations/[id]/administration-lifecycle-reviews/[reviewId]/execute/route.ts",
  "PATCH app/api/locations/[id]/administration-lifecycle-reviews/[reviewId]/execute/route.ts",
  "POST app/api/locations/[id]/verification-reviews/[reviewId]/route.ts",
  "POST app/api/locations/[id]/verification-reviews/[reviewId]/execute/route.ts",
  "PATCH app/api/locations/[id]/verification-reviews/[reviewId]/execute/route.ts",
  "POST app/api/locations/[id]/verification-completion-reviews/[reviewId]/route.ts",
  "POST app/api/locations/[id]/verification-completion-reviews/[reviewId]/execute/route.ts",
  "PATCH app/api/locations/[id]/verification-completion-reviews/[reviewId]/execute/route.ts",
  "POST app/api/locations/[id]/place-action-reviews/[reviewId]/route.ts",
  "POST app/api/locations/[id]/place-action-reviews/[reviewId]/execute/route.ts",
  "PATCH app/api/locations/[id]/place-action-reviews/[reviewId]/execute/route.ts",
  "POST app/api/locations/[id]/posts/[postId]/publish/route.ts",
  "POST app/api/locations/[id]/posts/[postId]/approval/route.ts",
  "DELETE app/api/locations/[id]/posts/[postId]/route.ts",
  "POST app/api/locations/[id]/post-schedules/[scheduleId]/approve/route.ts",
  "POST app/api/reviews/[id]/approval/route.ts",
  "POST app/api/reviews/[id]/publish/route.ts",
  "DELETE app/api/reviews/[id]/reply/route.ts",
  "POST app/api/listings/bulk/[id]/approve/route.ts",
  "POST app/api/listings/bulk/[id]/execute/route.ts",
  "POST app/api/listings/bulk/[id]/retry/route.ts",
  "PATCH app/api/settings/route.ts",
  "PATCH app/api/organisations/route.ts",
  "POST app/api/legal-holds/route.ts",
  "DELETE app/api/legal-holds/route.ts",
  "POST app/api/privacy/requests/route.ts",
  "PATCH app/api/privacy/requests/route.ts",
]

/** Handlers that call requireRecentMfa for their sensitive branch only. */
const IN_HANDLER: Record<string, string> = {
  // Approving publishes; triage and assignment do not.
  "POST app/api/reviews/bulk/route.ts": "app/api/reviews/bulk/route.ts",
  // Editing a published post republishes it; editing a draft does not.
  "PATCH app/api/locations/[id]/posts/[postId]/route.ts": "lib/server/posts.ts",
  // Detaching every location; renaming or recolouring a client does not.
  "PATCH app/api/clients/[clientId]/route.ts":
    "app/api/clients/[clientId]/route.ts",
}

/** Routes that must stay reachable at aal1. */
const NEVER: readonly string[] = [
  "app/api/auth/mfa/enroll/route.ts",
  "app/api/auth/mfa/verify/route.ts",
  "app/api/auth/mfa/factors/route.ts",
  "app/api/auth/mfa/step-up/route.ts",
  "app/api/privacy/export/route.ts",
  "app/api/session/switch/route.ts",
]

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return routeFiles(path)
    return entry.name === "route.ts" ? [relative(repoRoot, path)] : []
  })
}

/** Each exported handler's source, from its export to the next one. */
function handlers(file: string): Map<string, string> {
  const source = readFileSync(join(repoRoot, file), "utf8")
  const pattern = /export const (GET|POST|PUT|PATCH|DELETE) = /g
  const found = [...source.matchAll(pattern)]
  return new Map(
    found.map((match, index) => [
      match[1],
      source.slice(match.index, found[index + 1]?.index ?? source.length),
    ])
  )
}

const DECLARES = /\bmfa: "step_up"/

describe("MFA step-up declarations", () => {
  const files = routeFiles(join(repoRoot, "app/api"))

  it.each(STEP_UP.map((key) => [key]))("%s declares step_up", (key) => {
    const [method, file] = key.split(" ")
    const handler = handlers(file).get(method)
    expect(handler, `${key} does not exist`).toBeDefined()
    expect(handler).toMatch(DECLARES)
  })

  it.each(Object.entries(IN_HANDLER))(
    "%s calls requireRecentMfa",
    (key, module) => {
      const [method, file] = key.split(" ")
      expect(handlers(file).get(method)).toBeDefined()
      expect(readFileSync(join(repoRoot, module), "utf8")).toMatch(
        /requireRecentMfa\(/
      )
    }
  )

  it("declares it nowhere else", () => {
    const declared = files.flatMap((file) =>
      [...handlers(file)]
        .filter(([, source]) => DECLARES.test(source))
        .map(([method]) => `${method} ${file}`)
    )
    expect(declared.sort()).toEqual([...STEP_UP].sort())
  })

  it("never on a read, enrollment, export or workspace switch", () => {
    for (const file of files) {
      const get = handlers(file).get("GET")
      if (get) expect(get, file).not.toMatch(DECLARES)
    }
    for (const file of NEVER) {
      expect(readFileSync(join(repoRoot, file), "utf8"), file).not.toMatch(
        /mfa: "step_up"|requireRecentMfa\(/
      )
    }
  })
})
