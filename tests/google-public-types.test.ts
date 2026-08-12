import { describe, expect, it } from "vitest"

import type {
  GooglePerformancePoint,
  GooglePlaceActionLink,
  GoogleSearchKeywordPoint,
} from "@/lib/server/google"

describe("Google provider public types", () => {
  it("keeps legacy response fields mutable", () => {
    // Given: values typed through the public compatibility facade.
    const performancePoint: GooglePerformancePoint = {
      metric: "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
      date: "2026-08-08",
      value: 1,
    }
    const keywordPoint: GoogleSearchKeywordPoint = {
      keyword: "hotel",
      impressions: 1,
      threshold: null,
    }
    const placeActionLink: GooglePlaceActionLink = {
      name: "locations/1/placeActionLinks/1",
      providerType: "MERCHANT",
      isEditable: true,
      uri: "https://example.test/book",
      placeActionType: "APPOINTMENT",
      isPreferred: false,
      createTime: null,
      updateTime: null,
    }

    // When: a legacy consumer updates fields on those response values.
    performancePoint.value = 2
    keywordPoint.impressions = 2
    placeActionLink.isPreferred = true

    // Then: the mutations remain valid and observable.
    expect({
      performanceValue: performancePoint.value,
      keywordImpressions: keywordPoint.impressions,
      placeActionPreferred: placeActionLink.isPreferred,
    }).toEqual({
      performanceValue: 2,
      keywordImpressions: 2,
      placeActionPreferred: true,
    })
  })
})
