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

export type SendResult =
  | { status: "sent"; providerMessageId: string | null }
  | { status: "suppressed"; reason: string }
  | { status: "failed"; code: string; retryable: boolean }

const SEND_TIMEOUT_MS = 10_000

export function emailConfigured(): boolean {
  const env = getServerEnv()
  return env.EMAIL_PROVIDER !== "none" && Boolean(env.EMAIL_API_KEY && env.EMAIL_FROM)
}

export async function sendEmail(message: EmailMessage): Promise<SendResult> {
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
  } catch {
    return { status: "failed", code: "email_network_error", retryable: true }
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
