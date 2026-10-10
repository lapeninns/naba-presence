import { describe, expect, it } from "vitest"

import { redactForLog, redactUrls } from "@/lib/domain/redaction"

describe("structured log redaction", () => {
  it("redacts verification PIN field variants without hiding unrelated pinning fields", () => {
    expect(redactForLog({ pin: "001234", PIN_CODE: "001234", verificationPin: "001234", nested: { verification_pin_code: "001234", pinCode: "001234", pinned: true, spinning: "visible" } })).toEqual({ pin: "[REDACTED]", PIN_CODE: "[REDACTED]", verificationPin: "[REDACTED]", nested: { verification_pin_code: "[REDACTED]", pinCode: "[REDACTED]", pinned: true, spinning: "visible" } })
  })
  it("redacts credential-shaped object fields recursively", () => {
    expect(
      redactForLog({
        access_token: "access-secret",
        nested: { clientSecret: "client-secret", okay: "visible" },
      })
    ).toEqual({
      access_token: "[REDACTED]",
      nested: { clientSecret: "[REDACTED]", okay: "visible" },
    })
  })

  it("redacts bearer values and JWTs embedded in messages", () => {
    const result = redactForLog(
      "Authorization failed for Bearer abc.def-123 and eyJabcdefghij.payload.signature"
    )
    expect(result).not.toContain("abc.def-123")
    expect(result).not.toContain("eyJabcdefghij")
  })

  it("serialises errors without stack traces", () => {
    expect(redactForLog(new Error("Bearer very-secret"))).toEqual({
      name: "Error",
      message: "Bearer [REDACTED]",
    })
  })

  it("redacts credential query parameters in URL-shaped strings", () => {
    const result = redactForLog(
      "GET https://api.example.test/v1/x?token=tok-1&page=2&access_token=acc-2 failed; retry /callback?code=oauth-3&state=s"
    ) as string
    expect(result).not.toContain("tok-1")
    expect(result).not.toContain("acc-2")
    expect(result).not.toContain("oauth-3")
    expect(result).toContain("?token=[REDACTED]&page=2&access_token=[REDACTED]")
    expect(result).toContain("state=s")
  })

  it("redacts api keys, secrets and signatures but keeps other parameters", () => {
    expect(
      redactUrls(
        "https://x.test/a?key=k1&api_key=k2&client_secret=k3&X-Goog-Signature=k4&q=menu"
      )
    ).toBe(
      "https://x.test/a?key=[REDACTED]&api_key=[REDACTED]&client_secret=[REDACTED]&X-Goog-Signature=[REDACTED]&q=menu"
    )
  })

  it("redacts user:pass@ credentials in a URL", () => {
    const result = redactForLog(
      "connect postgresql://runtime:s3cret@db.example.test:5432/naba failed"
    )
    expect(result).toBe(
      "connect postgresql://[REDACTED]@db.example.test:5432/naba failed"
    )
    expect(redactUrls("https://user@example.test/x")).toBe(
      "https://[REDACTED]@example.test/x"
    )
  })

  it("does not mistake an email in a query or path for userinfo", () => {
    expect(redactUrls("https://example.test/u/a@b.test?email=c@d.test")).toBe(
      "https://example.test/u/a@b.test?email=c@d.test"
    )
  })

  it("redacts URL strings nested inside objects", () => {
    expect(
      redactForLog({ url: "https://x.test/?refresh_token=r1" })
    ).toEqual({ url: "https://x.test/?refresh_token=[REDACTED]" })
  })

  it("redacts a token carried in a URL fragment", () => {
    expect(
      redactUrls("https://app.test/cb#access_token=opaque-1&state=s1")
    ).toBe("https://app.test/cb#access_token=[REDACTED]&state=s1")
  })

  it("stays linear on long runs of word boundaries", () => {
    // An unbounded scheme class made this ~2s for 80k characters.
    const started = performance.now()
    redactForLog("a.".repeat(100_000))
    redactForLog(`${"a.".repeat(50_000)}://user:pw@host`)
    expect(performance.now() - started).toBeLessThan(250)
  })
})
