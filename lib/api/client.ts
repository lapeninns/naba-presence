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

/**
 * Per-request options every `lib/api` read function accepts and forwards.
 *
 * - `signal`: aborts the underlying fetch. React Query hands one to every
 *   `queryFn`; forwarding it means a superseded request (a new inbox search
 *   keystroke, a rapid filter toggle, an unmounted tab) is cancelled instead
 *   of racing the live one.
 * - `background`: see the 401 rule on `apiFetch`.
 */
export type RequestOptions = {
  signal?: AbortSignal
  background?: boolean
}

type ApiFetchOptions<T> = RequestOptions & {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  body?: unknown
  schema?: ZodType<T>
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

/**
 * 401 rule: a `401 authentication_required` stashes every registered draft
 * and hard-navigates to `/sign-in?next=…` ONLY for foreground requests — the
 * ones a user is waiting on (initial query loads, mutations, imperative calls
 * from components). Background requests (`background: true`) throw the
 * `ApiClientError` and nothing else, so a window-focus or interval refetch of
 * data already on screen cannot yank the user off a half-edited page.
 *
 * `lib/queries` decides which is which: `requestOptions(ctx)` marks a fetch
 * as background when its query already holds data (React Query's own
 * definition of a refetch), which is exactly what focus/interval refetches
 * are. Callers outside React Query never set `background`, so they keep the
 * redirect.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions<T> = {}
): Promise<T> {
  const { method = "GET", body, schema, signal, background = false } = options
  const response = await fetch(path, {
    method,
    signal,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await readPayload(response)

  if (!response.ok) {
    const code = payload.error ?? "http_error"
    if (
      response.status === 401 &&
      code === "authentication_required" &&
      !background
    ) {
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
