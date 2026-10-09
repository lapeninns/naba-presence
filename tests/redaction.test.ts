import { describe, expect, it } from "vitest"

import { redactForLog, redactUrls } from "@/lib/domain/redaction"

describe("structured log redaction", () => {
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
})
