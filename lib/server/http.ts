import "server-only"

import { trace } from "@opentelemetry/api"
import { NextResponse } from "next/server"
import { ZodError, type ZodIssue, type ZodType } from "zod"

import { log } from "@/lib/server/logger"

export type ApiErrorOptions = {
  fieldErrors?: Record<string, string>
  retryable?: boolean
  reconnectRequired?: boolean
  details?: unknown
  requestId?: string
}

function fieldErrorsFromZod(issues: ZodIssue[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {}
  for (const issue of issues) {
    const path = issue.path.length > 0 ? issue.path.join(".") : "_root"
    if (!fieldErrors[path]) fieldErrors[path] = issue.message
  }
  return fieldErrors
}

function errorBody(input: {
  code: string
  message: string
  fieldErrors?: Record<string, string>
  retryable?: boolean
  reconnectRequired?: boolean
  details?: unknown
  requestId?: string
}) {
  return {
    error: input.code,
    message: input.message,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.fieldErrors && Object.keys(input.fieldErrors).length > 0
      ? { fieldErrors: input.fieldErrors }
      : {}),
    ...(input.retryable ? { retryable: true } : {}),
    ...(input.reconnectRequired ? { reconnectRequired: true } : {}),
    ...(input.details !== undefined ? { details: input.details } : {}),
  }
}

export const REQUEST_ID_HEADER = "x-request-id"

/**
 * Echoes the server request id on a response so clients and logs can be
 * correlated. Headers on a fetched Response are immutable, so fall back to a
 * copy in that case.
 */
export function withRequestIdHeader<T extends Response>(
  response: T,
  requestId: string
): T {
  try {
    response.headers.set(REQUEST_ID_HEADER, requestId)
    return response
  } catch {
    const copy = new NextResponse(response.body, response)
    copy.headers.set(REQUEST_ID_HEADER, requestId)
    return copy as unknown as T
  }
}

/**
 * Maps anything thrown by a handler to a JSON error response. Pass the
 * server request id so the body and the `x-request-id` header carry it; the
 * route wrapper (`lib/server/route.ts`) always does.
 */
export function apiError(error: unknown, requestId?: string) {
  const response = mapError(error, requestId)
  return requestId ? withRequestIdHeader(response, requestId) : response
}

/** `details.retryAfter` (seconds) on a 429, as the Retry-After header. */
function retryAfterHeaders(error: ApiError): HeadersInit | undefined {
  if (error.status !== 429) return undefined
  const retryAfter = (error.details as { retryAfter?: unknown } | undefined)
    ?.retryAfter
  return typeof retryAfter === "number" &&
    Number.isFinite(retryAfter) &&
    retryAfter > 0
    ? { "retry-after": String(Math.ceil(retryAfter)) }
    : undefined
}

/**
 * The location-limit trigger's refusal (0110 location_link_enforce_limit:
 * SQLSTATE 23514, message `location_limit_reached`, the limit as its
 * detail) as the 402 every linking surface answers with; null for anything
 * else. Mapped here so every route that links a location answers the same
 * way without each one catching it. Flows that catch errors themselves and
 * record an error code (the onboarding creation and match links) call it in
 * their catch and record `location_limit_reached`.
 */
export function locationLimitError(error: unknown): ApiError | null {
  if (typeof error !== "object" || error === null) return null
  const { code, message, detail } = error as {
    code?: unknown
    message?: unknown
    detail?: unknown
  }
  if (code !== "23514" || message !== "location_limit_reached") return null
  const limit = typeof detail === "string" ? Number.parseInt(detail, 10) : NaN
  return locationLimitReachedError(Number.isFinite(limit) ? limit : null)
}

/** The 402 a linking surface answers with once the location limit is reached. */
export function locationLimitReachedError(limit: number | null): ApiError {
  return new ApiError(
    402,
    "location_limit_reached",
    "This workspace has reached its plan's location limit. Unlink a location or change plan to link another.",
    { details: { limit } }
  )
}

/**
 * The 400 a request whose own input failed its schema answers with: the
 * route wrapper's params, query and body parsing (lib/server/route.ts).
 */
export function invalidRequestError(error: ZodError): ApiError {
  return new ApiError(
    400,
    "invalid_request",
    "The request did not pass validation.",
    { fieldErrors: fieldErrorsFromZod(error.issues), details: error.issues }
  )
}

/**
 * Where a failed schema points, without the values: the paths and issue
 * codes are safe to log and say what drifted; the values may be personal
 * data or provider payloads.
 */
function issueShape(issues: ZodIssue[]) {
  return issues
    .slice(0, 20)
    .map((issue) => ({ path: issue.path.join("."), code: issue.code }))
}

function mapError(error: unknown, requestId?: string): NextResponse {
  const limitReached = locationLimitError(error)
  if (limitReached) return mapError(limitReached, requestId)
  if (error instanceof ApiError) {
    return NextResponse.json(
      errorBody({
        code: error.code,
        message: error.message,
        fieldErrors: error.fieldErrors,
        retryable: error.retryable,
        reconnectRequired: error.reconnectRequired,
        details: error.details,
        requestId: error.requestId ?? requestId,
      }),
      { status: error.status, headers: retryAfterHeaders(error) }
    )
  }
  if (error instanceof ZodError) {
    // The wrapper's own input parsing never gets here (it throws
    // invalidRequestError), so this is a handler-internal parse: some guard
    // the caller's input on purpose, others parse provider or stored data
    // that should use parseUpstream / parseStored. It keeps its 400 so the
    // deliberate ones still work, but is logged so the rest are visible.
    log.warn("api.unclassified_validation_error", {
      requestId,
      issues: issueShape(error.issues),
    })
    return mapError(invalidRequestError(error), requestId)
  }
  log.error("api.unhandled_error", { error, requestId })
  return NextResponse.json(
    errorBody({
      code: "internal_error",
      message: "The request could not be completed.",
      requestId,
    }),
    { status: 500 }
  )
}

export class ApiError extends Error {
  readonly fieldErrors?: Record<string, string>
  readonly retryable: boolean
  readonly reconnectRequired: boolean
  readonly details?: unknown
  readonly requestId?: string

  constructor(
    public status: number,
    public code: string,
    message: string,
    options: ApiErrorOptions = {}
  ) {
    super(message)
    this.fieldErrors = options.fieldErrors
    this.retryable = Boolean(options.retryable)
    this.reconnectRequired = Boolean(options.reconnectRequired)
    this.details = options.details
    this.requestId = options.requestId
  }
}

/**
 * The error taxonomy (W3-3). A schema failure is the caller's fault only
 * when the schema guards the caller's own input (400, invalidRequestError).
 * Two other kinds are ours to see and fix, and must reach 5xx alerting:
 *
 * - `UpstreamResponseError` (502): a provider answered with a body we
 *   cannot read. Their contract drifted, nothing the caller sent was wrong.
 * - `InvariantError` (500): data we stored, or a value the server built
 *   itself, failed its own schema. A bug or a bad row.
 *
 * Throw them with `parseUpstream` / `parseStored` at the parse site rather
 * than `schema.parse`. Each logs one error line where it is thrown (so a
 * caller that catches it, a job or a setup flow recording the code, is still
 * seen), with the issue paths and codes only; the client body never echoes
 * the issues.
 */
export class UpstreamResponseError extends ApiError {
  constructor(
    readonly provider: string,
    readonly operation: string,
    readonly issues: ZodIssue[],
    code = `${provider}_invalid_response`
  ) {
    super(502, code, "A provider returned a response we could not read.", {
      retryable: true,
    })
  }
}

export class InvariantError extends ApiError {
  constructor(
    readonly subject: string,
    readonly issues: ZodIssue[]
  ) {
    super(500, "internal_error", "The request could not be completed.")
  }
}

/**
 * `schema.parse(value)` for a provider's response body: a failure is a 502
 * `${provider}_invalid_response` (UpstreamResponseError), not a 400.
 * `operation` names the call in the log line.
 */
export function parseUpstream<T>(
  schema: ZodType<T>,
  value: unknown,
  source: { provider: string; operation: string; code?: string }
): T {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  log.error("api.upstream_invalid_response", {
    provider: source.provider,
    operation: source.operation,
    issues: issueShape(parsed.error.issues),
  })
  throw new UpstreamResponseError(
    source.provider,
    source.operation,
    parsed.error.issues,
    source.code
  )
}

/**
 * `schema.parse(value)` for stored data or a value the server assembled:
 * a failure is a 500 (InvariantError), not a 400. `subject` names what was
 * being read in the log line.
 */
export function parseStored<T>(
  schema: ZodType<T>,
  value: unknown,
  subject: string
): T {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  log.error("api.invariant_violation", {
    subject,
    issues: issueShape(parsed.error.issues),
  })
  throw new InvariantError(subject, parsed.error.issues)
}

export function serverRequestId(request: Request): {
  id: string
  clientId: string | null
} {
  const clientId = request.headers.get("x-request-id")
  const id = crypto.randomUUID()
  trace.getActiveSpan()?.setAttribute("nabapresence.request_id", id)
  if (clientId) {
    trace
      .getActiveSpan()
      ?.setAttribute("nabapresence.client_request_id", clientId)
  }
  return { id, clientId }
}
