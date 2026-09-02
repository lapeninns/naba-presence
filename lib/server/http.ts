import "server-only"

import { trace } from "@opentelemetry/api"
import { NextResponse } from "next/server"
import { ZodError, type ZodIssue } from "zod"

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

function mapError(error: unknown, requestId?: string) {
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
      { status: error.status }
    )
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      errorBody({
        code: "invalid_request",
        message: "The request did not pass validation.",
        fieldErrors: fieldErrorsFromZod(error.issues),
        details: error.issues,
        requestId,
      }),
      { status: 400 }
    )
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
