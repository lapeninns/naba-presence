import { describe, expect, it } from "vitest"

import {
  calls,
  functionBody,
  routeConfigString,
  routeFiles,
  scanRouteFile,
  scanRouteSource,
} from "./helpers/route-scanner"

/**
 * Which handlers demand a recent two-step verification (P02-S9).
 *
 * Owners and admins step up before sensitive team, Google connection,
 * publishing/approval and settings actions; reading, enrollment, exports and
 * invoice viewing stay allowed at aal1. This static scan pins the list: each
 * handler below declares `mfa: "step_up"` in its own route() config, or
 * calls `requireRecentMfa` in its own handler code (or in the one named lib
 * function its handler calls) where only part of it is sensitive
 * (IN_HANDLER). A new sensitive handler belongs here; a stale entry fails.
 * Behaviour is covered by tests/server/mfa-step-up.test.ts and
 * tests/integration/routes/mfa-step-up.test.ts.
 *
 * The owner-only billing mutations (P07-S5) step up too; reading the
 * billing state (GET /api/billing) stays at aal1.
 */

const STEP_UP: readonly string[] = [
  "POST app/api/members/route.ts",
  "PATCH app/api/members/route.ts",
  "DELETE app/api/members/route.ts",
  "PUT app/api/members/[userId]/client-access/route.ts",
  "POST app/api/clients/[clientId]/locations/route.ts",
  "DELETE app/api/clients/[clientId]/locations/route.ts",
  "POST app/api/invitations/route.ts",
  "POST app/api/invitations/[token]/resend/route.ts",
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
  "POST app/api/locations/[id]/google-changes/[changeId]/route.ts",
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
  "POST app/api/billing/checkout/route.ts",
  "POST app/api/billing/portal/route.ts",
  "POST app/api/billing/plan-change/route.ts",
  "POST app/api/billing/cancel/route.ts",
]

/**
 * Handlers that call requireRecentMfa for their sensitive branch only:
 * "handler" when the call is in the handler's own route() code, or
 * "module#function" for the lib function the handler calls that makes it.
 */
const IN_HANDLER: Record<string, string> = {
  // Approving and template replies (a batch its starter decides) publish;
  // triage and assignment do not.
  "POST app/api/reviews/bulk/route.ts": "handler",
  // Editing a published post republishes it; editing a draft does not.
  "PATCH app/api/locations/[id]/posts/[postId]/route.ts":
    "lib/server/posts.ts#updateLocalPostDraft",
  // Resuming a schedule re-arms its approved publication; pausing and
  // cancelling stop work and stay at aal1.
  "PATCH app/api/locations/[id]/post-schedules/[scheduleId]/route.ts":
    "handler",
  // Detaching every location; renaming or recolouring a client does not.
  "PATCH app/api/clients/[clientId]/route.ts": "handler",
}

/** Routes that must stay reachable at aal1. */
const NEVER: readonly string[] = [
  "app/api/auth/mfa/enroll/route.ts",
  "app/api/auth/mfa/verify/route.ts",
  "app/api/auth/mfa/factors/route.ts",
  "app/api/auth/mfa/step-up/route.ts",
  "app/api/privacy/export/route.ts",
  "app/api/session/switch/route.ts",
  "app/api/billing/route.ts",
]

/** Each exported handler's own route() code, by method. */
function handlers(file: string): Map<string, string> {
  return new Map(
    scanRouteFile(file).handlers.map((handler) => [
      handler.method,
      handler.config,
    ])
  )
}

/** `mfa: "step_up"` at the top level of the handler's route() config. */
const declaresStepUp = (config: string) =>
  routeConfigString(config, "mfa") === "step_up"

/** Why `config` does not reach requireRecentMfa through `where`, or null. */
function stepUpGap(config: string, where: string): string | null {
  if (where === "handler") {
    return calls(config, "requireRecentMfa")
      ? null
      : "the handler does not call requireRecentMfa"
  }
  const [module, name] = where.split("#")
  if (!calls(config, name!)) return `the handler does not call ${name}`
  return calls(functionBody(module!, name!), "requireRecentMfa")
    ? null
    : `${where} does not call requireRecentMfa`
}

describe("MFA step-up declarations", () => {
  const files = routeFiles()

  it.each(STEP_UP.map((key) => [key]))("%s declares step_up", (key) => {
    const [method, file] = key.split(" ")
    const handler = handlers(file).get(method)
    expect(handler, `${key} does not exist`).toBeDefined()
    expect(declaresStepUp(handler!), key).toBe(true)
  })

  it.each(Object.entries(IN_HANDLER))(
    "%s calls requireRecentMfa",
    (key, where) => {
      const [method, file] = key.split(" ")
      const handler = handlers(file!).get(method!)
      expect(handler, `${key} does not exist`).toBeDefined()
      expect(stepUpGap(handler!, where), key).toBeNull()
    }
  )

  it("declares it nowhere else", () => {
    const declared = files.flatMap((file) =>
      [...handlers(file)]
        .filter(([, config]) => declaresStepUp(config))
        .map(([method]) => `${method} ${file}`)
    )
    expect(declared.sort()).toEqual([...STEP_UP].sort())
  })

  it("never on a read, enrollment, export or workspace switch", () => {
    for (const file of files) {
      const get = handlers(file).get("GET")
      if (get) expect(declaresStepUp(get), file).toBe(false)
    }
    for (const file of NEVER) {
      const route = scanRouteFile(file)
      for (const handler of route.handlers) {
        expect(declaresStepUp(handler.config), handler.key).toBe(false)
      }
      expect(calls(route.code, "requireRecentMfa"), file).toBe(false)
    }
  })

  // The checker itself: each regression must be caught, so a loosened
  // matcher cannot pass silently.
  it("does not take a step-up call in another handler, a helper, a comment or a string", () => {
    const patch = (source: string) =>
      scanRouteSource("fixture/route.ts", source).handlers.find(
        (handler) => handler.method === "PATCH"
      )!.config
    expect(
      stepUpGap(
        patch(
          "export const PATCH = route({\n  handler: async ({ session }) => {\n    requireRecentMfa(session)\n  },\n})\n"
        ),
        "handler"
      )
    ).toBeNull()
    for (const source of [
      // Commented out.
      "export const PATCH = route({\n  handler: async ({ session }) => {\n    // requireRecentMfa(session)\n  },\n})\n",
      "export const PATCH = route({\n  handler: async () => {\n    /* requireRecentMfa(session) */\n  },\n})\n",
      // Only text.
      'export const PATCH = route({\n  handler: async () => log("requireRecentMfa(session)"),\n})\n',
      // In another handler of the module.
      "export const POST = route({\n  handler: async ({ session }) => requireRecentMfa(session),\n})\nexport const PATCH = route({\n  handler: async () => ok(),\n})\n",
      // In a module helper the handler never calls.
      "export const PATCH = route({\n  handler: async () => ok(),\n})\nfunction unused(session) {\n  requireRecentMfa(session)\n}\n",
    ]) {
      expect(stepUpGap(patch(source), "handler"), source).toBe(
        "the handler does not call requireRecentMfa"
      )
    }
    expect(
      stepUpGap(
        "route({ handler: async () => ok() })",
        "lib/server/posts.ts#updateLocalPostDraft"
      )
    ).toBe("the handler does not call updateLocalPostDraft")
  })

  it("reads mfa only from the handler's own config", () => {
    const configs = scanRouteSource(
      "fixture/route.ts",
      [
        "export const POST = route({",
        '  // mfa: "step_up",',
        "  handler: async () => ok(),",
        "})",
        "export const PATCH = route({",
        '  handler: async () => send({ mfa: "step_up" }),',
        "})",
        "export const PUT: Handler = route({",
        '  mfa: "step_up",',
        "  handler: async () => ok(),",
        "})",
      ].join("\n")
    ).handlers.map((handler) => [
      handler.method,
      declaresStepUp(handler.config),
    ])
    expect(configs).toEqual([
      ["POST", false],
      ["PATCH", false],
      ["PUT", true],
    ])
  })
})
