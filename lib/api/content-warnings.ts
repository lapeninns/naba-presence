import { ApiClientError } from "@/lib/api/client"

/**
 * A refusal for content warnings the person has not acknowledged yet (409
 * `content_warning_acknowledgement_required`, lib/server/content-checks.ts):
 * the warnings, in words, and the consent token that acknowledges exactly
 * them. `item` is the change of a bulk batch it is about, when it is one.
 */
export type ContentWarning = {
  token: string
  messages: string[]
  item?: number
}

type Details = {
  contentWarningAcknowledgement?: unknown
  reasons?: { message?: unknown }[]
  item?: unknown
}

function reasonMessages(details: Details | undefined): string[] {
  return (details?.reasons ?? []).flatMap((reason) =>
    typeof reason?.message === "string" ? [reason.message] : []
  )
}

/** The warnings to acknowledge, or null for any other error. */
export function contentWarningFromError(error: unknown): ContentWarning | null {
  if (
    !(error instanceof ApiClientError) ||
    error.code !== "content_warning_acknowledgement_required"
  )
    return null
  const details = error.details as Details | undefined
  const token = details?.contentWarningAcknowledgement
  if (typeof token !== "string") return null
  return {
    token,
    messages: reasonMessages(details),
    ...(typeof details?.item === "number" ? { item: details.item } : {}),
  }
}

/** Why content checks refused the content (422 `content_checks_failed`), or null. */
export function contentCheckFailureText(error: unknown): string | null {
  if (
    !(error instanceof ApiClientError) ||
    error.code !== "content_checks_failed"
  )
    return null
  const messages = reasonMessages(error.details as Details | undefined)
  return messages.length ? messages.join(" ") : null
}
