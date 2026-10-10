import { describe, expect, it } from "vitest"

import { retiredGoogleApi } from "@/lib/domain/google-retired-apis"

describe("retiredGoogleApi", () => {
  it.each([
    [
      "https://mybusinessbusinesscalls.googleapis.com/v1/locations/1/businesscallssettings",
      "business_calls",
    ],
    [
      "https://mybusinessbusinesscalls.googleapis.com/v1/locations/1/businesscallsinsights?pageSize=100",
      "business_calls",
    ],
    [
      "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/healthProviderAttributes",
      "health_provider_attributes",
    ],
    [
      "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/insuranceNetworks?pageSize=10000",
      "insurance_networks",
    ],
    [
      "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/questions",
      "questions_and_answers",
    ],
    [
      "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/questions/3/answers",
      "questions_and_answers",
    ],
    [
      "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/questions/3/answers:upsert",
      "questions_and_answers",
    ],
    [
      "https://mybusinessqanda.googleapis.com/v1/locations/2/questions",
      "questions_and_answers",
    ],
    [
      "https://mybusiness.googleapis.com/v4/accounts/1/locations/2:associate",
      "location_association",
    ],
    [
      "https://mybusiness.googleapis.com/v4/accounts/1/locations/2:clearLocationAssociation",
      "location_association",
    ],
    [
      "https://mybusiness.googleapis.com/v4/accounts/1/locations:associate",
      "location_association",
    ],
    [
      "https://mybusinessbusinessinformation.googleapis.com/v1/locations/1:associate",
      "location_association",
    ],
    [
      "https://mybusinessbusinessinformation.googleapis.com/v1/locations/1:clearLocationAssociation",
      "location_association",
    ],
    [
      "https://mybusiness.googleapis.com/v4/accounts/1/locations:reportInsights",
      "location_insights",
    ],
    [
      "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts:reportInsights",
      "local_post_insights",
    ],
  ])("recognises %s as retired (%s)", (url, api) => {
    expect(retiredGoogleApi(url)).toBe(api)
  })

  it.each([
    "https://mybusinesslodging.googleapis.com/v1/locations/1/lodging?readMask=*",
    "https://mybusinesslodging.googleapis.com/v1/locations/1/lodging:getGoogleUpdated",
    "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/serviceList",
    "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews",
    "https://mybusiness.googleapis.com/v4/accounts/1/locations:batchGetReviews",
    "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/foodMenus",
    "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts",
    "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/media",
    "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/media:startUpload",
    "https://mybusiness.googleapis.com/v4/accounts/1/notifications",
    "https://mybusinessverifications.googleapis.com/v1/locations/2:fetchVerificationOptions",
    "https://mybusinessnotifications.googleapis.com/v1/accounts/1/notificationSetting",
    "https://mybusinessplaceactions.googleapis.com/v1/locations/2/placeActionLinks",
    "https://mybusinessbusinessinformation.googleapis.com/v1/locations/2?readMask=name",
    "https://businessprofileperformance.googleapis.com/v1/locations/2:fetchMultiDailyMetricsTimeSeries",
    "not a url",
  ])("leaves the supported endpoint %s alone", (url) => {
    expect(retiredGoogleApi(url)).toBeNull()
  })
})
