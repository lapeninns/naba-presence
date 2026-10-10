import { expect, it } from "vitest"
import { onboardingChainsQuerySchema, onboardingChainsResponseSchema } from "@/lib/contracts/google-onboarding-chains"

it("requires a saved revision and bounded nonempty chain search", () => {
  expect(onboardingChainsQuerySchema.parse({ expectedRevision: "2", query: "  Brand  " })).toEqual({ expectedRevision: 2, query: "Brand" })
  for (const input of [{ expectedRevision: 0, query: "Brand" }, { expectedRevision: 1, query: " " }, { expectedRevision: 1, query: "x".repeat(101) }, { expectedRevision: 1, query: "Brand", clientId: "injected" }]) expect(onboardingChainsQuerySchema.safeParse(input).success).toBe(false)
})

it("binds exact provider choices to draft identity and revision", () => {
  const response = { draftId: "10000000-0000-4000-8000-000000000001", revision: 1, payloadHash: "a".repeat(64), query: "Brand", choices: [{ name: "chains/123", label: "Brand" }] }
  expect(onboardingChainsResponseSchema.parse(response)).toEqual(response)
  expect(onboardingChainsResponseSchema.safeParse({ ...response, choices: [{ name: "Brand", label: "Brand" }] }).success).toBe(false)
  expect(onboardingChainsResponseSchema.safeParse({ ...response, choices: Array.from({ length: 101 }, () => response.choices[0]) }).success).toBe(false)
})
