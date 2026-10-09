import { describe, expect, it } from "vitest"

import { httpUrl } from "@/lib/contracts/http-url"
import { placeActionInputSchema } from "@/lib/contracts/location-place-actions"
import { businessInformationPayloadSchema } from "@/lib/domain/business-information"

const schema = httpUrl()

describe("httpUrl()", () => {
  it.each([
    "https://example.test",
    "http://example.test/menu?x=1#top",
    "https://example.test:8443/path",
  ])("accepts %j", (value) => {
    expect(schema.safeParse(value).success).toBe(true)
  })

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://example.test/file",
    "file:///etc/passwd",
    "mailto:someone@example.test",
    "https://user:pass@example.test",
    "https://user@example.test",
    "not a url",
    "",
  ])("rejects %j", (value) => {
    expect(schema.safeParse(value).success).toBe(false)
  })

  it("rejects a URL over 2048 characters", () => {
    const long = `https://example.test/${"a".repeat(2048)}`
    expect(schema.safeParse(long).success).toBe(false)
    const fits = `https://example.test/${"a".repeat(2048 - 21)}`
    expect(fits.length).toBe(2048)
    expect(schema.safeParse(fits).success).toBe(true)
  })

  it("carries the caller's message for a non-http scheme", () => {
    const result = httpUrl("Use a web link.").safeParse("javascript:alert(1)")
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      "Use a web link."
    )
  })

  it("is what the listing contracts use", () => {
    expect(
      placeActionInputSchema.safeParse({
        uri: "https://example.test/book",
        placeActionType: "DINING_RESERVATION",
      }).success
    ).toBe(true)
    expect(
      businessInformationPayloadSchema.safeParse({
        websiteUri: "https://example.test",
      }).success
    ).toBe(true)
    expect(
      placeActionInputSchema.safeParse({
        uri: "javascript:alert(1)",
        placeActionType: "DINING_RESERVATION",
      }).success
    ).toBe(false)
    expect(
      businessInformationPayloadSchema.safeParse({
        websiteUri: "data:text/html,hi",
      }).success
    ).toBe(false)
  })
})
