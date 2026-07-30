import "server-only"

import { trace } from "@opentelemetry/api"
import { NextResponse } from "next/server"
import { ZodError } from "zod"

import { log } from "@/lib/server/logger"

export function apiError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: error.status }
    )
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "invalid_request",
        message: "The request did not pass validation.",
        details: error.issues,
      },
      { status: 400 }
    )
  }
  log.error("api.unhandled_error", { error })
  return NextResponse.json(
    { error: "internal_error", message: "The request could not be completed." },
    { status: 500 }
  )
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message)
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
