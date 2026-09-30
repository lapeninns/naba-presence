import { createHmac } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  verifyEmailWebhook,
  WEBHOOK_TOLERANCE_SECONDS,
} from "@/lib/server/notifications/webhook"

const key = Buffer.from("unit-test-webhook-secret")
const secret = `whsec_${key.toString("base64")}`
const now = Date.UTC(2026, 8, 30, 12)
function headers(
  body: string,
  overrides: Record<string, string> = {},
  signingKey = key
) {
  const id = overrides["svix-id"] ?? "msg_1",
    timestamp = overrides["svix-timestamp"] ?? String(now / 1000)
  const signature = createHmac("sha256", signingKey)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64")
  return new Headers({
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}`,
    ...overrides,
  })
}

describe("verifyEmailWebhook", () => {
  const body = JSON.stringify({
    type: "email.delivered",
    created_at: "2026-09-30T12:00:00Z",
    data: { email_id: "e1" },
  })
  it("accepts a correctly signed request and returns its event id", () => {
    expect(verifyEmailWebhook(secret, headers(body), body, now)).toBe("msg_1")
  })
  it("accepts when any offered v1 signature matches", () => {
    const good = headers(body).get("svix-signature")!
    expect(
      verifyEmailWebhook(
        secret,
        headers(body, { "svix-signature": `v1,AAAA ${good}` }),
        body,
        now
      )
    ).toBe("msg_1")
  })
  it("rejects a tampered body, a wrong secret, a stale or future timestamp and missing headers", () => {
    expect(() =>
      verifyEmailWebhook(secret, headers(body), `${body} `, now)
    ).toThrow(/signature/)
    expect(() =>
      verifyEmailWebhook(
        secret,
        headers(body, {}, Buffer.from("other")),
        body,
        now
      )
    ).toThrow(/signature/)
    const stale = String(now / 1000 - WEBHOOK_TOLERANCE_SECONDS - 1)
    expect(() =>
      verifyEmailWebhook(
        secret,
        headers(body, { "svix-timestamp": stale }),
        body,
        now
      )
    ).toThrow(/signature/)
    const future = String(now / 1000 + WEBHOOK_TOLERANCE_SECONDS + 1)
    expect(() =>
      verifyEmailWebhook(
        secret,
        headers(body, { "svix-timestamp": future }),
        body,
        now
      )
    ).toThrow(/signature/)
    expect(() => verifyEmailWebhook(secret, new Headers(), body, now)).toThrow(
      /signature/
    )
    expect(() =>
      verifyEmailWebhook(
        secret,
        headers(body, { "svix-signature": "v2,abc" }),
        body,
        now
      )
    ).toThrow(/signature/)
  })
})
