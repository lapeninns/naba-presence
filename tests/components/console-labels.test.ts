import { describe, expect, it } from "vitest"

import {
  adminRoleLabel,
  attributeControlKind,
  callsStateLabel,
  categoryLabel,
  openStatusLabel,
  serviceAreaLabel,
  verificationMethodLabel,
} from "@/lib/locations/console-labels"

// U4: an empty verification field must render nothing, never the literal
// fallback word "Category" that titleCaseTail used to return for an empty
// tail (categoryLabel always passes a non-empty name, so this only bites
// the verification labels).

describe("console-labels humanisation (§7 — no raw enums to users)", () => {
  it("prefers a category's displayName and never leaks a raw gcid", () => {
    expect(categoryLabel({ name: "categories/gcid:hotel", displayName: "Hotel" })).toBe("Hotel")
    // No displayName -> a humanised gcid tail, never the raw "gcid:" string.
    const fallback = categoryLabel({ name: "categories/gcid:bed_and_breakfast" })
    expect(fallback).not.toMatch(/gcid|_|categories\//)
    expect(fallback.length).toBeGreaterThan(0)
  })
  it("humanises admin roles", () => {
    expect(adminRoleLabel("PRIMARY_OWNER")).toBe("Primary owner")
    expect(adminRoleLabel("OWNER")).toBe("Owner")
    expect(adminRoleLabel("MANAGER")).toBe("Manager")
    expect(adminRoleLabel("SOMETHING_NEW")).not.toMatch(/_/)
  })
  it("maps attribute value types to a control kind", () => {
    expect(attributeControlKind("BOOL")).toBe("bool")
    expect(attributeControlKind("ENUM")).toBe("enum")
    expect(attributeControlKind("REPEATED_ENUM")).toBe("unsupported")
    expect(attributeControlKind("URL")).toBe("url")
    expect(attributeControlKind("PHOTOS_LIST")).toBe("unsupported")
  })
  it("humanises the remaining console enums without underscores", () => {
    expect(openStatusLabel("CLOSED_PERMANENTLY")).toBe("Permanently closed")
    expect(serviceAreaLabel("CUSTOMER_LOCATION_ONLY")).not.toMatch(/_/)
    expect(callsStateLabel("ENABLED")).toBe("On")
    expect(verificationMethodLabel("PHONE_CALL")).not.toMatch(/_/)
  })
  it("renders a neutral empty result for an empty verification value, never the literal 'Category'", () => {
    expect(verificationMethodLabel("")).toBe("")
    expect(verificationMethodLabel("")).not.toBe("Category")
  })
  it("still humanises a real category name (unaffected by the empty-tail fallback)", () => {
    expect(categoryLabel({ name: "categories/gcid:hotel" })).toBe("Hotel")
  })
})
