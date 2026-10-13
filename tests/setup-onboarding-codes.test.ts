import { describe, expect, it } from "vitest"

import { googleOnboardingPayloadSchema } from "@/lib/contracts/google-onboarding"
import { googleServiceAreaSchema } from "@/lib/domain/google-service-area"
import {
  codeForText,
  countryOptions,
  currencyOptions,
  languageOptions,
  typedCountryCode,
  typedCurrencyCode,
  typedLanguageTag,
  withCurrent,
} from "@/lib/setup/onboarding-codes"

describe("onboarding code lists", () => {
  it("lists only codes the server schemas accept", () => {
    for (const { code } of countryOptions()) expect(code).toMatch(/^[A-Z]{2}$/)
    for (const { code } of currencyOptions()) expect(code).toMatch(/^[A-Z]{3}$/)
    for (const { code } of languageOptions()) {
      expect(
        googleOnboardingPayloadSchema.safeParse({ languageCode: code }).success
      ).toBe(true)
    }
    expect(
      googleServiceAreaSchema.shape.regionCode.safeParse("GB").success
    ).toBe(true)
  })

  it("has the codes this product needs by default", () => {
    expect(countryOptions().map((o) => o.code)).toContain("GB")
    expect(currencyOptions().map((o) => o.code)).toContain("GBP")
    expect(languageOptions().map((o) => o.code)).toEqual(
      expect.arrayContaining(["en-GB", "cy"])
    )
  })

  it("keeps a saved code that is not listed, first and unchanged", () => {
    const options = withCurrent(countryOptions(), "XK", "region")
    expect(options[0].code).toBe("XK")
    expect(options).toHaveLength(countryOptions().length + 1)
    const lower = withCurrent(currencyOptions(), "gbp", "currency")
    expect(lower[0].code).toBe("gbp")
    expect(withCurrent(countryOptions(), "GB", "region")).toBe(countryOptions())
    expect(withCurrent(countryOptions(), "", "region")).toBe(countryOptions())
  })

  it("accepts any typed code the schemas accept, never stricter", () => {
    expect(typedCountryCode("xk", countryOptions())).toBe("XK")
    expect(typedCountryCode("G", countryOptions())).toBeNull()
    expect(typedCurrencyCode("xts", [])).toBe("XTS")
    expect(typedCurrencyCode("GB", [])).toBeNull()
    expect(typedLanguageTag("mi-NZ", languageOptions())).toBe("mi-NZ")
    expect(typedLanguageTag("not a tag", languageOptions())).toBeNull()
    expect(typedLanguageTag("en-GB", languageOptions())).toBeNull()
  })

  it("maps typed text to a listed code ignoring case", () => {
    expect(codeForText("gb", countryOptions())).toBe("GB")
    expect(codeForText("en-gb", languageOptions())).toBe("en-GB")
    expect(codeForText("e", languageOptions())).toBeNull()
    expect(codeForText("  ", countryOptions())).toBeNull()
    expect(
      codeForText("xk", countryOptions(), (t) =>
        typedCountryCode(t, countryOptions())
      )
    ).toBe("XK")
  })
})
