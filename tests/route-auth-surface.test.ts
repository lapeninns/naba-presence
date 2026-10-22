import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import ts from "typescript"
import { describe, expect, it } from "vitest"

/**
 * The unauthenticated surface of app/api is pinned (NP8-G02).
 *
 * route() runs requireSession() unless a handler declares `auth: "public"`
 * (the handler authenticates itself, or nobody needs to) or `auth: "cron"`
 * (the CRON_SECRET bearer). tests/route-authorization-contract.test.ts
 * polices what session mutations may do; this file pins which handlers are
 * not session handlers at all, so turning one into a public or cron
 * handler, or adding a new one, fails here until the list below is updated
 * with its reason. A stale entry fails too.
 *
 * Handlers are read from the TypeScript syntax tree, so a commented-out
 * `auth:` cannot count, and any export of an HTTP method this reader cannot
 * resolve to `route({ ... })` with a literal `auth` is reported instead of
 * being skipped.
 */

const repoRoot = fileURLToPath(new URL("../", import.meta.url))

const HTTP_METHODS = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
])

/** `auth: "public"` handlers, by "METHOD file", with why. */
const PUBLIC: Record<string, string> = {
  "GET app/api/auth/callback/google/route.ts":
    "OAuth redirect target; state and PKCE are checked inside",
  "POST app/api/auth/callback/google/route.ts":
    "OAuth form-post target; state and PKCE are checked inside",
  "GET app/api/auth/mfa/factors/route.ts":
    "lists factors for a pending sign-in ticket, before a session exists",
  "POST app/api/auth/mfa/verify/route.ts":
    "completes a pending sign-in or enrolment ticket with a code",
  "DELETE app/api/auth/mfa/verify/route.ts":
    "abandons the caller's pending ticket",
  "POST app/api/auth/password/login/route.ts": "password sign-in",
  "POST app/api/auth/password/register/route.ts": "registration",
  "POST app/api/auth/password/resend/route.ts": "resends a confirmation email",
  "POST app/api/auth/password/reset/complete/route.ts":
    "completes a reset with its emailed token",
  "POST app/api/auth/password/reset/request/route.ts": "requests a reset email",
  "GET app/api/invitations/[token]/route.ts":
    "invitation lookup by its secret token, before sign-in",
  "GET app/api/operations/health/route.ts": "liveness for uptime checks",
  "GET app/api/session/route.ts": "answers whether there is a session",
  "DELETE app/api/session/route.ts":
    "signs out whatever session the cookie names",
  "POST app/api/support/impersonation/route.ts":
    "support staff authenticate with SUPPORT_IMPERSONATION_SECRET inside",
  "POST app/api/sync/keywords/route.ts":
    "session-or-cron hybrid, authenticated inside (401, 403)",
  "POST app/api/sync/performance/route.ts":
    "session-or-cron hybrid, authenticated inside (401, 403)",
  "POST app/api/sync/reconcile/route.ts":
    "session-or-cron hybrid, authenticated inside (401, 403)",
  "POST app/api/sync/sweep/route.ts":
    "session-or-cron hybrid, authenticated inside (401, 403)",
  "POST app/api/webhooks/email/route.ts": "provider webhook, signature checked",
  "POST app/api/webhooks/google/pubsub/route.ts":
    "Pub/Sub push, OIDC token or verification token checked",
  "POST app/api/webhooks/google/risc/route.ts":
    "Google RISC security events, signed JWT checked",
  "POST app/api/webhooks/stripe/route.ts": "Stripe webhook, signature checked",
}

/** `auth: "cron"` handlers: schedulers and operators with CRON_SECRET. */
const CRON = [
  "GET app/api/billing/reconcile/route.ts",
  "GET app/api/cron/health/route.ts",
  "POST app/api/cron/health/route.ts",
  "GET app/api/cron/retention/route.ts",
  "POST app/api/cron/retention/route.ts",
  "GET app/api/jobs/run/route.ts",
  "POST app/api/jobs/run/route.ts",
  "GET app/api/operations/organisations/[id]/ai-credits/route.ts",
  "POST app/api/operations/organisations/[id]/ai-credits/route.ts",
  "PUT app/api/operations/organisations/[id]/ai-credits/route.ts",
  "GET app/api/operations/readiness/route.ts",
  "POST app/api/operations/reencrypt/route.ts",
  "GET app/api/sync/keywords/route.ts",
  "GET app/api/sync/performance/route.ts",
  "GET app/api/sync/presence-resources/route.ts",
  "POST app/api/sync/presence-resources/route.ts",
  "GET app/api/sync/reconcile/route.ts",
  "GET app/api/sync/sweep/route.ts",
]

type Handler = { key: string; auth: string }
type Reading = { handlers: Handler[]; unreadable: string[] }

const hasExport = (node: ts.Node) =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
  )

/** `auth` of a `route({ ... })` call, "session" when absent, else null. */
function routeAuth(initializer: ts.Expression | undefined): string | null {
  if (
    !initializer ||
    !ts.isCallExpression(initializer) ||
    !ts.isIdentifier(initializer.expression) ||
    initializer.expression.text !== "route"
  ) {
    return null
  }
  const config = initializer.arguments[0]
  if (!config || !ts.isObjectLiteralExpression(config)) return null
  let auth = "session"
  for (const property of config.properties) {
    if (ts.isSpreadAssignment(property)) return null
    if (!property.name || property.name.getText() !== "auth") continue
    if (
      !ts.isPropertyAssignment(property) ||
      !ts.isStringLiteralLike(property.initializer)
    ) {
      return null
    }
    auth = property.initializer.text
  }
  return auth
}

/** Every HTTP method export of one route module. */
function readRouteModule(file: string, source: string): Reading {
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const handlers: Handler[] = []
  const unreadable: string[] = []
  for (const statement of tree.statements) {
    if (ts.isVariableStatement(statement) && hasExport(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          unreadable.push(`${file}: destructured export`)
          continue
        }
        const method = declaration.name.text
        if (!HTTP_METHODS.has(method)) continue
        const auth = routeAuth(declaration.initializer)
        if (auth === null) unreadable.push(`${method} ${file}`)
        else handlers.push({ key: `${method} ${file}`, auth })
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      hasExport(statement) &&
      statement.name &&
      HTTP_METHODS.has(statement.name.text)
    ) {
      unreadable.push(`${statement.name.text} ${file}`)
    } else if (ts.isExportDeclaration(statement)) {
      unreadable.push(`${file}: export ${statement.getText().slice(7, 60)}`)
    } else if (ts.isExportAssignment(statement)) {
      unreadable.push(`${file}: export default`)
    }
  }
  return { handlers, unreadable }
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return routeFiles(path)
    return entry.name === "route.ts" ? [path] : []
  })
}

function readSurface(): Reading {
  const handlers: Handler[] = []
  const unreadable: string[] = []
  for (const path of routeFiles(join(repoRoot, "app/api"))) {
    const file = relative(repoRoot, path).split("\\").join("/")
    const reading = readRouteModule(file, readFileSync(path, "utf8"))
    handlers.push(...reading.handlers)
    unreadable.push(...reading.unreadable)
  }
  return { handlers, unreadable }
}

const keysWith = (handlers: Handler[], auth: string) =>
  handlers
    .filter((handler) => handler.auth === auth)
    .map((handler) => handler.key)
    .sort()

describe("route auth surface", () => {
  const { handlers, unreadable } = readSurface()

  it("reads every handler under app/api", () => {
    expect(handlers.length).toBeGreaterThan(200)
    expect(unreadable).toEqual([])
  })

  it("knows only the session, public and cron modes", () => {
    expect(
      [...new Set(handlers.map((handler) => handler.auth))].sort()
    ).toEqual(["cron", "public", "session"])
  })

  it("pins every unauthenticated (public) handler", () => {
    expect(keysWith(handlers, "public")).toEqual(Object.keys(PUBLIC).sort())
  })

  it("pins every cron-bearer handler", () => {
    expect(keysWith(handlers, "cron")).toEqual([...CRON].sort())
  })

  // The reader itself: each way a handler could slip past must be caught.
  describe("reader", () => {
    const read = (source: string) =>
      readRouteModule("app/api/x/route.ts", source)

    it("ignores an auth mode that is only in a comment", () => {
      expect(
        read(`
          // export const GET = route({ auth: "public" })
          export const POST = route({
            /* auth: "public", */
            handler: async () => ({}),
          })
        `)
      ).toEqual({
        handlers: [{ key: "POST app/api/x/route.ts", auth: "session" }],
        unreadable: [],
      })
    })

    it("finds an indented, same-line export", () => {
      expect(
        read(
          `  export const GET = route({ auth: "cron", handler: f }); export const PUT = route({ auth: "public", handler: f })`
        ).handlers
      ).toEqual([
        { key: "GET app/api/x/route.ts", auth: "cron" },
        { key: "PUT app/api/x/route.ts", auth: "public" },
      ])
    })

    it("reports a handler it cannot resolve instead of skipping it", () => {
      expect(
        read(`
          export async function GET() { return new Response() }
          const mode = "public"
          export const POST = route({ auth: mode, handler: f })
          export const PATCH = route({ ...shared, handler: f })
          export const DELETE = wrapped(route({ auth: "public", handler: f }))
          export { GET as HEAD } from "../other/route"
        `).unreadable
      ).toEqual([
        "GET app/api/x/route.ts",
        "POST app/api/x/route.ts",
        "PATCH app/api/x/route.ts",
        "DELETE app/api/x/route.ts",
        'app/api/x/route.ts: export { GET as HEAD } from "../other/route"',
      ])
    })
  })
})
