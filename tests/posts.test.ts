import { describe, expect, it } from "vitest"

import { localPostInputSchema } from "@/lib/server/posts"

describe("Local Posts validation", () => {
  it("accepts standard, event, and offer payloads", () => {
    expect(localPostInputSchema.parse({
      topicType: "STANDARD",
      summary: "A summer update",
      media: [],
    }).topicType).toBe("STANDARD")
    expect(localPostInputSchema.parse({
      topicType: "EVENT",
      summary: "Live music",
      event: { title: "Friday music", schedule: {} },
      media: [],
    }).topicType).toBe("EVENT")
    expect(localPostInputSchema.parse({
      topicType: "OFFER",
      summary: "Lunch offer",
      event: { title: "Lunch", schedule: {} },
      offer: { couponCode: "LUNCH" },
      media: [],
    }).topicType).toBe("OFFER")
  })

  it("rejects incomplete offers and product post types", () => {
    expect(() => localPostInputSchema.parse({
      topicType: "OFFER",
      summary: "Missing details",
      media: [],
    })).toThrow(/Event details|required/)
    expect(() => localPostInputSchema.parse({
      topicType: "PRODUCT",
      summary: "Unsupported",
      media: [],
    })).toThrow()
  })
})
