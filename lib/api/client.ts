import type { ZodType } from "zod"

import { hardNavigate } from "@/lib/client/hard-navigate"
import {
  MFA_ENROLLMENT_REQUIRED,
  MFA_STEP_UP_REQUIRED,
} from "@/lib/contracts/auth"
import {
  LISTING_CHANGE_AWAITING_APPROVAL,
  listingChangeParkedResponseSchema,
} from "@/lib/contracts/listing-changes"
import { INTENT_HEADER } from "@/lib/contracts/mutation-operations"

import { stashAllDrafts } from "./draft-stash"

/**
 * True for the 202 a listing write answers when two-person approval parked
 * it: not a failure, and nothing reached Google.
 */
export function isAwaitingApproval(error: unknown): error is ApiClientError {
  return (
    error instanceof ApiClientError &&
    error.code === LISTING_CHANGE_AWAITING_APPROVAL
  )
}

export class ApiClientError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown
  readonly fieldErrors?: Record<string, string>
  readonly retryable: boolean
  readonly reconnectRequired: boolean
  readonly requestId?: string
  /**
   * The intent id the failed mutation was sent under. After an uncertain
   * failure, `GET /api/mutations/{intentId}` says what became of it.
   */
  readonly intentId?: string

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
      intentId?: string
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
    this.intentId = extras.intentId
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
  /**
   * One token per user intent, resent unchanged after a lost response; the
   * same `Idempotency-Key` an `intentId` sends (`intentId` wins when both
   * are given).
   */
  idempotencyKey?: string
}

type ApiFetchOptions<T> = RequestOptions & {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  body?: unknown
  schema?: ZodType<T>
  /**
   * The intent this mutation belongs to, sent as `Idempotency-Key`. Pass the
   * same id when retrying the same user action so the server answers from
   * its receipt instead of writing twice. Omitted, every mutation gets a
   * fresh one.
   */
  intentId?: string
}

/**
 * What a `lib/api` mutation wrapper accepts besides its input: the intent the
 * call belongs to (see `intentId` above). `useResourceMutation` and
 * `usePublishFlow` hand one to every call and resend it on a retry of the
 * same action.
 */
export type MutationOptions = { intentId?: string }

/** A fresh intent id, or undefined where the browser offers no UUIDs (non-secure origins). */
export function mintIntentId(): string | undefined {
  try {
    return globalThis.crypto?.randomUUID?.()
  } catch {
    return undefined
  }
}

/**
 * A stable fingerprint of what a call sends, for deciding whether a retry is
 * the same action. Files are compared by name, size, type and modification
 * time: their bytes are not read, and two different files never look alike
 * to JSON (both serialise as `{}`).
 */
export function intentFingerprint(value: unknown): string {
  return (
    JSON.stringify(value, (_key, item: unknown) => {
      if (typeof Blob !== "undefined" && item instanceof Blob) {
        const file = item as Blob & { name?: string; lastModified?: number }
        return {
          blob: [
            file.name ?? null,
            file.size,
            file.type,
            file.lastModified ?? null,
          ],
        }
      }
      if (typeof FormData !== "undefined" && item instanceof FormData) {
        return { form: [...item.entries()] }
      }
      return item
    }) ?? "undefined"
  )
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

/**
 * The window event a sensitive action's 403 raises when two-step
 * verification is due (`mfa_step_up_required`) or not set up yet
 * (`mfa_enrollment_required`). components/auth/mfa-step-up-prompt.tsx
 * listens for it and asks for the code; the caller still gets the error,
 * so its own error path keeps the edit and says what happened.
 */
export const MFA_STEP_UP_EVENT = "naba:mfa-step-up"

export type MfaStepUpEventDetail = {
  code: typeof MFA_STEP_UP_REQUIRED | typeof MFA_ENROLLMENT_REQUIRED
}

/** True for the 403 a sensitive action answers when a code is due. */
export function isMfaStepUpError(error: unknown): error is ApiClientError {
  return (
    error instanceof ApiClientError &&
    error.status === 403 &&
    (error.code === MFA_STEP_UP_REQUIRED ||
      error.code === MFA_ENROLLMENT_REQUIRED)
  )
}

function requestStepUp(code: MfaStepUpEventDetail["code"]): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<MfaStepUpEventDetail>(MFA_STEP_UP_EVENT, {
      detail: { code },
    })
  )
}

function handleUnauthorized(): void {
  stashAllDrafts()
  const next = encodeURIComponent(
    window.location.pathname + window.location.search
  )
  hardNavigate(`/sign-in?next=${next}`)
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
  const intentId =
    method === "GET"
      ? undefined
      : (options.intentId ?? options.idempotencyKey ?? mintIntentId())
  const headers: Record<string, string> = {}
  if (body !== undefined) headers["content-type"] = "application/json"
  if (intentId) headers[INTENT_HEADER] = intentId
  let response: Response
  try {
    response = await fetch(path, {
      method,
      signal,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    // fetch() rejects with a TypeError when the connection drops or the
    // request never got an answer -- for a write, the one case where it may
    // still have been applied. Wrapped so the error keeps the intent it was
    // sent under, which a retry resends and `GET /api/mutations/{intentId}`
    // answers for (the upload XHR in lib/api/location-media.ts does the
    // same). Reads, and an aborted or timed-out request, rethrow as they are.
    if (intentId && error instanceof TypeError) {
      throw new ApiClientError(
        0,
        "network_error",
        "We couldn’t reach NabaPresence. Check your connection and try again.",
        undefined,
        { intentId }
      )
    }
    throw error
  }
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
    if (
      response.status === 403 &&
      (code === MFA_STEP_UP_REQUIRED || code === MFA_ENROLLMENT_REQUIRED) &&
      !background
    ) {
      requestStepUp(code)
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
        intentId,
      }
    )
  }

  // 204/empty bodies carry no payload; returning "" would fail every schema
  // and surprise callers such as signOut.
  if (response.status === 204) return undefined as T

  // A listing write parked for a second publisher's approval (two-person
  // mode, lib/server/listing-changes.ts): nothing was sent to Google, so it
  // is not the answer the caller's schema describes. Raised as its own
  // code -- never a failure -- with the change request in `details`, so
  // every editor's error path can say "sent for approval" and keep the edit.
  if (response.status === 202) {
    const parked = listingChangeParkedResponseSchema.safeParse(payload.raw)
    if (parked.success) {
      throw new ApiClientError(
        202,
        LISTING_CHANGE_AWAITING_APPROVAL,
        "Sent for approval. Another publisher needs to approve this change before it goes to Google.",
        {
          changeRequest: parked.data.changeRequest,
          operationId: parked.data.operation.operationId,
          outcome: "awaiting_approval",
        },
        { requestId: payload.requestId, intentId }
      )
    }
  }

  if (!schema) return payload.raw as T
  const parsed = schema.safeParse(payload.raw)
  if (!parsed.success) {
    // The server answered 2xx, so a write behind it was applied: the intent
    // lets a retry be answered from its receipt instead of writing again.
    throw new ApiClientError(
      500,
      "malformed_response",
      "The server response did not match the expected shape.",
      parsed.error.issues,
      { intentId }
    )
  }
  return parsed.data
}
