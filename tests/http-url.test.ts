import { afterEach, describe, expect, it, vi } from "vitest"

import { httpUrl } from "@/lib/contracts/http-url"
import { placeActionInputSchema } from "@/lib/contracts/location-place-actions"
import { bulkOperationInputSchema } from "@/lib/domain/bulk-merge"
import { businessInformationPayloadSchema } from "@/lib/domain/business-information"
import { googleAttributeWriteSchema } from "@/lib/domain/google-attributes"

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

  it("is what bulk action links and URL attributes use", () => {
    const bulkLink = (uri: string) =>
      bulkOperationInputSchema.safeParse({
        operation: "place_action",
        action: "upsert",
        placeActionType: "DINING_RESERVATION",
        uri,
      }).success
    const urlAttribute = (uri: string) =>
      googleAttributeWriteSchema.safeParse({
        name: "attributes/url_menu",
        uriValues: [{ uri }],
      }).success
    expect(bulkLink("https://example.test/book")).toBe(true)
    expect(urlAttribute("https://example.test/menu")).toBe(true)
    for (const unsafe of [
      "javascript:alert(1)",
      "https://user:secret@example.test/",
    ]) {
      expect(bulkLink(unsafe)).toBe(false)
      expect(urlAttribute(unsafe)).toBe(false)
    }
  })

  describe("in a browser without the static URL.parse (Safari 17, Chrome < 126)", () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it("still validates instead of throwing", () => {
      // The profile editor parses businessInformationPayloadSchema client-side.
      vi.spyOn(URL, "parse").mockImplementation(() => {
        throw new TypeError("URL.parse is not a function")
      })
      expect(schema.safeParse("https://a.test").success).toBe(true)
      expect(schema.safeParse("https://user:pw@a.test").success).toBe(false)
      expect(schema.safeParse("not a url").success).toBe(false)
      expect(
        businessInformationPayloadSchema.safeParse({ websiteUri: "" }).success
      ).toBe(true)
      expect(
        businessInformationPayloadSchema.safeParse({ websiteUri: "nope" })
          .success
      ).toBe(false)
    })
  })
})
