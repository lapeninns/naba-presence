import type { ZodType } from "zod"

import { stashAllDrafts } from "./draft-stash"

export class ApiClientError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown
  readonly fieldErrors?: Record<string, string>
  readonly retryable: boolean
  readonly reconnectRequired: boolean
  readonly requestId?: string

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
    extras: {
      fieldErrors?: Record<string, string>
      retryable?: boolean
      reconnectRequired?: boolean
      requestId?: string
    } = {}
  ) {
    super(message)
    this.name = "ApiClientError"
    this.status = status
    this.code = code
    this.details = details
    this.fieldErrors = extras.fieldErrors
    this.retryable = Boolean(extras.retryable)
    this.reconnectRequired = Boolean(extras.reconnectRequired)
    this.requestId = extras.requestId
  }
}

type ApiFetchOptions<T> = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  body?: unknown
  schema?: ZodType<T>
  signal?: AbortSignal
}

async function readPayload(response: Response): Promise<{
  error?: string
  message?: string
  details?: unknown
  fieldErrors?: Record<string, string>
  retryable?: boolean
  reconnectRequired?: boolean
  requestId?: string
  raw: unknown
}> {
  const text = await response.text()
  try {
    const parsed: unknown = JSON.parse(text)
    const record = (parsed ?? {}) as Record<string, unknown>
    const fieldErrors =
      record.fieldErrors &&
      typeof record.fieldErrors === "object" &&
      !Array.isArray(record.fieldErrors)
        ? (record.fieldErrors as Record<string, string>)
        : undefined
    return {
      error: typeof record.error === "string" ? record.error : undefined,
      message: typeof record.message === "string" ? record.message : undefined,
      details: record.details,
      fieldErrors,
      retryable: record.retryable === true,
      reconnectRequired: record.reconnectRequired === true,
      requestId:
        typeof record.requestId === "string" ? record.requestId : undefined,
      raw: parsed,
    }
  } catch {
    return { raw: text }
  }
}

function handleUnauthorized(): void {
  stashAllDrafts()
  const next = encodeURIComponent(
    window.location.pathname + window.location.search
  )
  window.location.assign(`/sign-in?next=${next}`)
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions<T> = {}
): Promise<T> {
  const { method = "GET", body, schema, signal } = options
  const response = await fetch(path, {
    method,
    signal,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await readPayload(response)

  if (!response.ok) {
    const code = payload.error ?? "http_error"
    if (response.status === 401 && code === "authentication_required") {
      handleUnauthorized()
    }
    throw new ApiClientError(
      response.status,
      code,
      payload.message ?? `Request failed (${response.status}).`,
      payload.details,
      {
        fieldErrors: payload.fieldErrors,
        retryable: payload.retryable,
        reconnectRequired: payload.reconnectRequired,
        requestId: payload.requestId,
      }
    )
  }

  // 204/empty bodies carry no payload; returning "" would fail every schema
  // and surprise callers such as signOut.
  if (response.status === 204) return undefined as T

  if (!schema) return payload.raw as T
  const parsed = schema.safeParse(payload.raw)
  if (!parsed.success) {
    throw new ApiClientError(
      500,
      "malformed_response",
      "The server response did not match the expected shape.",
      parsed.error.issues
    )
  }
  return parsed.data
}
