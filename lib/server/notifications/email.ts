import "server-only"

import { getServerEnv } from "@/lib/server/env"

/**
 * Transactional email for operational alerts.
 *
 * The only email NabaPresence sent before this was Supabase Auth's own, so
 * there is no provider to reuse. This is a small interface with one adapter
 * (Resend's HTTP API, chosen because it needs nothing but a fetch) and a
 * "none" default. With no provider configured, every send reports
 * `suppressed` and the incident still shows in the app: nothing is lost,
 * nobody is emailed, and nothing claims an email went out.
 *
 * `EMAIL_API_BASE_URL` exists so tests point the adapter at a local stub;
 * no test ever reaches a real provider.
 */

export type EmailMessage = {
  to: string
  subject: string
  text: string
}

/**
 * `uncertain`: the request may have reached the provider (a timeout, or a
 * connection that dropped after it was established), so whether an email went
 * out is unknown. Only an idempotent retry -- the same `Idempotency-Key`,
 * inside the provider's window -- may send it again; anything else risks a
 * duplicate. `failed` means the provider certainly did not accept it.
 */
export type SendResult =
  | { status: "sent"; providerMessageId: string | null }
  | { status: "suppressed"; reason: string }
  | { status: "failed"; code: string; retryable: boolean }
  | { status: "uncertain"; code: string }

const SEND_TIMEOUT_MS = 10_000

/**
 * Errors raised before a connection to the provider existed: nothing was
 * sent, so the send is certainly not delivered and safe to try again.
 */
const NOT_CONNECTED_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EADDRNOTAVAIL",
  "UND_ERR_CONNECT_TIMEOUT",
])

function errorCode(error: unknown): string | null {
  for (let current = error, depth = 0; current && depth < 4; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === "string") return code
    current = (current as { cause?: unknown }).cause
  }
  return null
}

/**
 * Classifies a thrown fetch. A refused or unresolvable connection never
 * carried the request; a timeout, an abort or a dropped socket may have, so
 * those are uncertain rather than failed. Unknown errors are uncertain too:
 * guessing "not sent" is what would email someone twice.
 */
export function classifySendError(error: unknown): SendResult {
  const code = errorCode(error)
  if (code && NOT_CONNECTED_CODES.has(code)) {
    return { status: "failed", code: "email_connect_failed", retryable: true }
  }
  const name = (error as { name?: unknown } | null)?.name
  if (name === "TimeoutError" || name === "AbortError") {
    return { status: "uncertain", code: "email_timeout" }
  }
  return { status: "uncertain", code: "email_connection_lost" }
}

export function emailConfigured(): boolean {
  const env = getServerEnv()
  return (
    env.EMAIL_PROVIDER !== "none" &&
    Boolean(env.EMAIL_API_KEY && env.EMAIL_FROM)
  )
}

export async function sendTenantEmail(
  message: EmailMessage,
  options: { readonly idempotencyKey?: string } = {}
): Promise<SendResult> {
  if (!getServerEnv().TENANT_EMAIL_ENABLED) {
    return { status: "suppressed", reason: "tenant_email_disabled" }
  }
  return sendEmail(message, options)
}

/**
 * `idempotencyKey` is sent as Resend's `Idempotency-Key`: a retry after a lost
 * response returns the first send instead of emailing again.
 */
export async function sendEmail(
  message: EmailMessage,
  options: { readonly idempotencyKey?: string } = {}
): Promise<SendResult> {
  const env = getServerEnv()
  if (!emailConfigured()) {
    return { status: "suppressed", reason: "provider_not_configured" }
  }
  let response: Response
  try {
    response = await fetch(new URL("/emails", env.EMAIL_API_BASE_URL), {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.EMAIL_API_KEY}`,
        "content-type": "application/json",
        ...(options.idempotencyKey
          ? { "idempotency-key": options.idempotencyKey }
          : {}),
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
  } catch (error) {
    return classifySendError(error)
  }
  if (response.ok) {
    const body = (await response.json().catch(() => ({}))) as { id?: unknown }
    return {
      status: "sent",
      providerMessageId: typeof body.id === "string" ? body.id : null,
    }
  }
  return {
    status: "failed",
    code: `email_http_${response.status}`,
    // 4xx other than rate limiting will fail the same way next time.
    retryable: response.status === 429 || response.status >= 500,
  }
}
