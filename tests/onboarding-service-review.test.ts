import { expect, it } from "vitest"
import { onboardingServiceReviewRows } from "@/lib/locations/onboarding-service-review"

it("reviews the exact suggested service ID and decimal price without rounding", () => {
  const rows = onboardingServiceReviewRows([{ structuredServiceItem: { serviceTypeId: "job:repair", description: "Repair pipes" }, price: { currencyCode: "GBP", units: "1234567890123456", nanos: 123456789 } }])
  expect(rows).toContainEqual({ label: "Service 1 Google ID", value: "job:repair" })
  expect(rows).toContainEqual({ label: "Service 1 price", value: "GBP 1234567890123456.123456789" })
})

it("distinguishes omitted values and explicit zero while preserving custom category/language", () => {
  const rows = onboardingServiceReviewRows([
    { freeFormServiceItem: { category: "categories/gcid:plumber", label: { displayName: "Inspection", languageCode: "cy" } } },
    { structuredServiceItem: { serviceTypeId: "job:repair", description: "" }, price: { currencyCode: "GBP", units: "0", nanos: 0 } },
  ])
  expect(rows).toContainEqual({ label: "Service 1 category", value: "categories/gcid:plumber" })
  expect(rows).toContainEqual({ label: "Service 1 language", value: "cy" })
  expect(rows).toContainEqual({ label: "Service 1 price", value: "Not supplied" })
  expect(rows).toContainEqual({ label: "Service 1 description", value: "Not supplied" })
  expect(rows).toContainEqual({ label: "Service 2 description", value: "" })
  expect(rows).toContainEqual({ label: "Service 2 price", value: "GBP 0" })
})

it("does not invent currency or amount for incomplete optional provider money", () => {
  const rows = onboardingServiceReviewRows([{ structuredServiceItem: { serviceTypeId: "job:repair" }, price: {} }])
  expect(rows).toContainEqual({ label: "Service 1 price", value: "Currency not supplied Amount not supplied" })
})
