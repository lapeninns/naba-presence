import "server-only"

import { NextResponse } from "next/server"
import type { TransactionSql } from "postgres"
import type { ZodType } from "zod"

import { secretEqual } from "@/lib/server/crypto"
import { withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import {
  ApiError,
  apiError,
  serverRequestId,
  withRequestIdHeader,
} from "@/lib/server/http"
import { requireRole, requireSession, type Session } from "@/lib/server/session"

/**
 * One skeleton for every `app/api/** /route.ts` handler.
 *
 * `route({...})` returns a Next.js route handler. The wrapper owns, in order:
 *
 *   1. the request id — generated once via `serverRequestId(request)`, exposed
 *      as `ctx.requestId` / `ctx.clientRequestId` (the caller's
 *      `x-request-id`, if any), echoed back as the `x-request-id` response
 *      header on both success and error, and handed to `apiError(error,
 *      requestId)` so every error body carries it. Handlers pass
 *      `ctx.requestId` to `writeAudit` / `log` — never call `serverRequestId`
 *      again inside a handler;
 *   2. authentication — `auth: "session"` (default) runs `requireSession()`;
 *      `auth: "cron"` requires `authorization: Bearer <CRON_SECRET>` compared
 *      with `secretEqual` and throws 401 `invalid_cron_token` otherwise;
 *      `auth: "public"` gives `session: null` (the handler may still call
 *      `getSession()` itself, e.g. session-or-cron hybrids);
 *   3. organisation-level role gating — `roles: ["owner", "admin"]` runs
 *      `requireRole` (403 `permission_denied`). Roles are declared in the
 *      route, not inside the handler. Location-level access is NOT a wrapper
 *      concern: handlers still call `requireLocationAccess`,
 *      `canPublishLocation` or `grantsFor` from `lib/server/permissions`
 *      inside `ctx.tenant(...)` once they know which location is involved;
 *   4. parsing — `params` (zod schema over the awaited `context.params`),
 *      `query` (zod schema over an object built from `searchParams`, where a
 *      repeated key becomes a string array; or a plain function receiving the
 *      raw `URLSearchParams` for bespoke decoding) and `body` (zod schema
 *      over the JSON body; a missing or unparsable body becomes `{}` before
 *      validation so `.default()` fields work and required fields produce a
 *      400 instead of a 500). Zod failures map to 400 `invalid_request` with
 *      `fieldErrors`, exactly as `apiError` always did;
 *   5. the tenant transaction — `ctx.tenant(fn)` is
 *      `withTenant(session.organisationId, fn)` and is only present when
 *      `auth` is `"session"`. Cron/public handlers import `withTenant` /
 *      `getDatabase` directly (cross-tenant enumeration must be commented as
 *      such in the route file);
 *   6. the response — a returned `Response`/`NextResponse` is passed through
 *      (build one when you need a non-200 status, a redirect or a non-JSON
 *      body); any other value becomes `NextResponse.json(value)`;
 *   7. error mapping — everything thrown (ApiError, ZodError, unknown) goes
 *      through `apiError(error, requestId)` unchanged.
 *
 * Not owned by the wrapper: `export const runtime = "nodejs"` and
 * `export const maxDuration` stay per-file static exports (Next requires them
 * to be literal exports it can read at build time), and kill switches /
 * capability checks stay inside the handler or the domain module.
 *
 * Usage:
 *
 *   export const runtime = "nodejs"
 *
 *   export const PUT = route({
 *     roles: ["owner", "admin"],
 *     params: z.object({ id: z.uuid() }),
 *     body: saveSchema,
 *     handler: async ({ session, params, body, requestId, tenant }) =>
 *       tenant(async (sql) => {
 *         await requireLocationAccess(sql, session, params.id)
 *         ...
 *         await writeAudit(sql, { ..., requestId })
 *         return { saved: true }
 *       }),
 *   })
 *
 *   export const POST = route({
 *     auth: "cron",
 *     query: (searchParams) => ({ cursor: searchParams.get("cursor") }),
 *     handler: async ({ query, requestId }) => runSweep(query.cursor, requestId),
 *   })
 *
 *   export const GET = route({
 *     auth: "public",
 *     params: z.object({ token: z.string().min(1) }),
 *     handler: async ({ params }) => lookupInvitation(params.token),
 *   })
 */

export type AuthMode = "session" | "cron" | "public"

/** Path params as Next.js delivers them, before any schema is applied. */
export type RawParams = Record<string, string | string[] | undefined>

export type TenantRunner = <T>(
  fn: (sql: TransactionSql) => Promise<T>
) => Promise<T>

export type RouteContext<
  A extends AuthMode = "session",
  P = RawParams,
  Q = URLSearchParams,
  B = undefined,
> = {
  request: Request
  requestId: string
  clientRequestId: string | null
  params: P
  query: Q
  body: B
} & (A extends "session"
  ? { session: Session; tenant: TenantRunner }
  : { session: null })

/** Anything a handler may return: a Response passes through; else JSON. */
export type RouteResult = Response | object | string | number | boolean | null

export type RouteConfig<
  A extends AuthMode = "session",
  P = RawParams,
  Q = URLSearchParams,
  B = undefined,
> = {
  /** Defaults to "session". */
  auth?: A
  /** Organisation roles allowed through. Only with auth "session". */
  roles?: A extends "session" ? Session["role"][] : never
  /** Validates the awaited `context.params`. */
  params?: ZodType<P>
  /**
   * Zod schema applied to an object built from `searchParams` (repeated keys
   * become arrays), or a function receiving the raw `URLSearchParams`.
   */
  query?: ZodType<Q> | ((searchParams: URLSearchParams) => Q)
  /** Validates the JSON body; missing/invalid JSON becomes `{}` first. */
  body?: ZodType<B>
  handler: (ctx: RouteContext<A, P, Q, B>) => RouteResult | Promise<RouteResult>
}

export type NextRouteContext = { params: Promise<RawParams> }

/**
 * The second argument is typed as required because Next's generated route
 * type check demands it; at runtime the wrapper tolerates its absence so
 * unit tests can call `GET(request)` for routes without path params.
 */
export type RouteHandler = (
  request: Request,
  context: NextRouteContext
) => Promise<Response>

/** Type helper for handlers declared outside `route({...})`. */
export type SessionRouteContext<
  P = RawParams,
  Q = URLSearchParams,
  B = undefined,
> = RouteContext<"session", P, Q, B>

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")
  if (!header) return null
  return header.replace(/^Bearer /, "")
}

/** True when the request carries `authorization: Bearer <CRON_SECRET>`. */
export function isCronRequest(request: Request): boolean {
  return secretEqual(bearerToken(request), getServerEnv().CRON_SECRET)
}

/** Throws the 401 every cron route uses when the bearer token is wrong. */
export function requireCronToken(request: Request): void {
  if (!isCronRequest(request)) {
    throw new ApiError(401, "invalid_cron_token", "Invalid cron token.")
  }
}

/** `?a=1&b=x&b=y` → `{ a: "1", b: ["x", "y"] }` */
export function searchParamsToObject(
  searchParams: URLSearchParams
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key)
    result[key] = values.length === 1 ? values[0] : values
  }
  return result
}

async function readJsonBody(request: Request): Promise<unknown> {
  const parsed = await request.json().catch(() => undefined)
  return parsed ?? {}
}

function isZodSchema(value: unknown): value is ZodType {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { parse?: unknown }).parse === "function"
  )
}

function toResponse(result: RouteResult): Response {
  return result instanceof Response ? result : NextResponse.json(result)
}

async function authenticate<A extends AuthMode>(
  request: Request,
  auth: A,
  roles: Session["role"][] | undefined
): Promise<Session | null> {
  if (auth === "cron") {
    requireCronToken(request)
    return null
  }
  if (auth === "public") return null
  const session = await requireSession()
  return roles ? requireRole(session, roles) : session
}

export function route<
  A extends AuthMode = "session",
  P = RawParams,
  Q = URLSearchParams,
  B = undefined,
>(config: RouteConfig<A, P, Q, B>): RouteHandler {
  const auth = (config.auth ?? "session") as A
  return async (request, context?: NextRouteContext) => {
    const rid = serverRequestId(request)
    try {
      const session = await authenticate(request, auth, config.roles)
      const rawParams = (await context?.params) ?? {}
      const params = (
        config.params ? config.params.parse(rawParams) : rawParams
      ) as P
      const searchParams = new URL(request.url).searchParams
      const query = (
        config.query === undefined
          ? searchParams
          : isZodSchema(config.query)
            ? config.query.parse(searchParamsToObject(searchParams))
            : config.query(searchParams)
      ) as Q
      const body = (
        config.body ? config.body.parse(await readJsonBody(request)) : undefined
      ) as B
      const base = {
        request,
        requestId: rid.id,
        clientRequestId: rid.clientId,
        params,
        query,
        body,
      }
      const ctx = (
        session
          ? {
              ...base,
              session,
              tenant: <T>(fn: (sql: TransactionSql) => Promise<T>) =>
                withTenant(session.organisationId, fn),
            }
          : { ...base, session: null }
      ) as unknown as RouteContext<A, P, Q, B>
      const result = await config.handler(ctx)
      return withRequestIdHeader(toResponse(result), rid.id)
    } catch (error) {
      return apiError(error, rid.id)
    }
  }
}
