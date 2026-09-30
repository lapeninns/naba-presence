import { expect, it } from "vitest"
import {
  onboardingCategoryPageSchema,
  onboardingCategoryQuerySchema,
} from "@/lib/contracts/google-onboarding-categories"

it("requires bounded category searches with explicit region and language", () => {
  const input = {
    connectionId: "00000000-0000-4000-8000-000000000001",
    regionCode: "GB",
    languageCode: "en-GB",
    query: " Shop ",
  }
  expect(onboardingCategoryQuerySchema.parse(input).query).toBe("Shop")
  for (const changed of [
    { query: " " },
    { query: "a".repeat(101) },
    { regionCode: "UKK" },
    { languageCode: "bad_tag" },
    { pageToken: "a".repeat(4097) },
    { organisationId: input.connectionId },
  ]) {
    expect(
      onboardingCategoryQuerySchema.safeParse({ ...input, ...changed }).success
    ).toBe(false)
  }
})

it("distinguishes empty category results from malformed provider responses", () => {
  expect(onboardingCategoryPageSchema.parse({})).toEqual({ categories: [] })
  const category = {
    name: "categories/gcid:shop",
    displayName: "Shop",
    serviceTypes: [],
  }
  expect(
    onboardingCategoryPageSchema.parse({
      categories: [category],
      nextPageToken: "page-2",
    })
  ).toEqual({
    categories: [{ name: category.name, displayName: category.displayName }],
    nextPageToken: "page-2",
  })
  for (const value of [
    null,
    { error: {} },
    { categories: null },
    { categories: [{ name: "shop", displayName: "Shop" }] },
    { categories: [{ name: category.name }] },
  ]) {
    expect(onboardingCategoryPageSchema.safeParse(value).success).toBe(false)
  }
})
