import { describe, expect, it } from "vitest"

import { placeActionInputSchema } from "@/lib/contracts/location-place-actions"
import {
  actionTypeLabel,
  checkBookingUrl,
  hostOf,
} from "@/lib/editors/booking-presentation"

/**
 * The booking-link form's own check (lib/editors/booking-presentation.ts):
 * it explains a bad link before the server does, and must never refuse a
 * link the wire contract (placeActionInputSchema) accepts.
 */

describe("checkBookingUrl", () => {
  it("accepts a full http or https address, trimmed", () => {
    expect(checkBookingUrl("https://book.example.co.uk/table")).toBeNull()
    expect(checkBookingUrl("  http://book.example.co.uk  ")).toBeNull()
  })

  it("says what to type when the field is empty", () => {
    expect(checkBookingUrl("   ")).toBe("Enter the link customers should open.")
  })

  it("asks for a full address when the text is not one", () => {
    for (const value of [
      "book.example.co.uk",
      "www.example.com/book",
      "/book",
    ]) {
      expect(checkBookingUrl(value), value).toBe(
        "That isn’t a full web address. It should look like https://book.example.co.uk"
      )
    }
  })

  it("refuses links that are not web pages", () => {
    for (const value of [
      "javascript:alert(1)",
      "mailto:bookings@example.co.uk",
      "ftp://example.co.uk/menu.pdf",
      "data:text/html,hi",
    ]) {
      expect(checkBookingUrl(value), value).toBe(
        "Use a web address that starts with https://"
      )
    }
  })

  it("refuses a link already on the same button, by exact address", () => {
    const existing = [{ uri: "https://book.example.co.uk/table" }]
    expect(
      checkBookingUrl(" https://book.example.co.uk/table ", existing)
    ).toBe("This link is already on the listing for that button.")
    expect(
      checkBookingUrl("https://book.example.co.uk/other", existing)
    ).toBeNull()
  })

  it("never refuses a link the server contract accepts", () => {
    for (const uri of [
      "https://book.example.co.uk",
      "http://book.example.co.uk/path?table=2#now",
      "https://xn--bcher-kva.example/",
      "https://192.0.2.10:8443/book",
      `https://example.co.uk/${"a".repeat(2000)}`,
    ]) {
      const server = placeActionInputSchema.safeParse({
        uri,
        placeActionType: "DINING_RESERVATION",
      }).success
      expect(server, uri).toBe(true)
      expect(checkBookingUrl(uri), uri).toBeNull()
    }
  })
})

describe("hostOf", () => {
  it("shows the host of a link, and the text itself when it is not one", () => {
    expect(hostOf("https://book.example.co.uk/table?x=1")).toBe(
      "book.example.co.uk"
    )
    expect(hostOf("not a link")).toBe("not a link")
  })
})

describe("actionTypeLabel", () => {
  it("names known types in the editor's words, and humanises the rest", () => {
    expect(actionTypeLabel("DINING_RESERVATION")).toBe("Reserve a table")
    expect(actionTypeLabel("FOOD_TAKEOUT")).toBe("Takeaway")
    expect(actionTypeLabel("SOME_FUTURE_TYPE")).toBe("Some future type")
  })
})
