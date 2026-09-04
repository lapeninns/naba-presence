import { describe, expect, it } from "vitest"

import { industryCapability } from "@/lib/locations/industry-capability"

describe("industryCapability", () => {
  it("asks Google nothing for a listing that carries neither flag", () => {
    // The real metadata for a pub, taken from the live API: Google returns
    // canHaveFoodMenus and placeId, and simply omits the two industry flags.
    const pub = {
      metadata: {
        canDelete: true,
        canHaveFoodMenus: true,
        hasVoiceOfMerchant: true,
        placeId: "ChIJr-Lmrdt22EcRpM90SQtZug4",
      },
    }
    expect(industryCapability(pub)).toEqual({
      lodging: false,
      health: false,
      any: false,
    })
  })

  it("asks when Google says the listing can operate lodging data", () => {
    const hotel = { metadata: { canOperateLodgingData: true } }
    expect(industryCapability(hotel)).toMatchObject({ lodging: true, any: true })
  })

  it("asks when Google says the listing can operate health data", () => {
    const clinic = { metadata: { canOperateHealthData: true } }
    expect(industryCapability(clinic)).toMatchObject({ health: true, any: true })
  })

  it("treats a missing, null or non-object metadata as no capability", () => {
    for (const location of [null, undefined, {}, { metadata: null }, "nonsense"]) {
      expect(industryCapability(location).any).toBe(false)
    }
  })

  it("does not accept a truthy non-true value as a capability", () => {
    // Google's booleans are booleans; anything else is a shape we do not know,
    // and guessing "yes" costs three and a half seconds of failing calls.
    expect(industryCapability({ metadata: { canOperateLodgingData: "yes" } }).any).toBe(false)
  })
})
