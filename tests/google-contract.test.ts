import { describe, expect, it } from "vitest"

import {
  googleAccountsRequest,
  googleBatchReviewsRequest,
  googleLocationHoursPatchRequest,
  googleLocationProfilePatchRequest,
  googleLocationRequest,
  googleMediaCreateRequest,
  googleMediaDeleteRequest,
  googleMediaListRequest,
  googleMediaPatchRequest,
  googleFoodMenusGetRequest,
  googleFoodMenusName,
  googleFoodMenusPatchRequest,
  googleLocalPostCreateRequest,
  googleLocalPostDeleteRequest,
  googleLocalPostPatchRequest,
  googleLocalPostsListRequest,
  googleNotificationSettingRequest,
  googlePerformanceRequest,
  googlePlaceActionLinkCreateRequest,
  googlePlaceActionLinkDeleteRequest,
  googlePlaceActionLinkPatchRequest,
  googlePlaceActionLinksListRequest,
  googleReplyRequest,
  googleSearchKeywordImpressionsRequest,
} from "@/lib/domain/google-contract"

describe("Google API request contracts", () => {
  it("builds a paginated account-list request", () => {
    const first = new URL(googleAccountsRequest().url)
    expect(first.searchParams.get("pageSize")).toBe("20")
    expect(first.searchParams.has("pageToken")).toBe(false)

    const next = new URL(googleAccountsRequest("next-page").url)
    expect(next.searchParams.get("pageToken")).toBe("next-page")
  })

  it("builds a paginated batchGetReviews request with canonical names", () => {
    const request = googleBatchReviewsRequest(
      "accounts/123",
      ["locations/456", "accounts/123/locations/789"],
      "next"
    )
    expect(request.url).toBe(
      "https://mybusiness.googleapis.com/v4/accounts/123/locations:batchGetReviews"
    )
    expect(JSON.parse(String(request.init.body))).toEqual({
      locationNames: [
        "accounts/123/locations/456",
        "accounts/123/locations/789",
      ],
      pageSize: 50,
      pageToken: "next",
      orderBy: "updateTime desc",
    })
  })

  it("enforces Google's 50-location batch limit", () => {
    expect(() =>
      googleBatchReviewsRequest(
        "accounts/123",
        Array.from({ length: 51 }, (_, index) => `locations/${index}`)
      )
    ).toThrow(/1–50/)
  })

  it("uses the text-only updateReply contract", () => {
    const request = googleReplyRequest(
      "accounts/1/locations/2/reviews/3",
      "Thank you."
    )
    expect(request.init.method).toBe("PUT")
    expect(JSON.parse(String(request.init.body))).toEqual({
      comment: "Thank you.",
    })
  })

  it("subscribes to the selected supported notification types", () => {
    const request = googleNotificationSettingRequest(
      "accounts/123",
      "projects/example-project/topics/gbp-reviews",
      ["NEW_REVIEW", "UPDATED_REVIEW", "GOOGLE_UPDATE"]
    )
    expect(JSON.parse(String(request.init.body)).notificationTypes).toEqual([
      "NEW_REVIEW",
      "UPDATED_REVIEW",
      "GOOGLE_UPDATE",
    ])
  })

  it("reads only the Google fields needed by Hours", () => {
    const request = googleLocationRequest("locations/456", [
      "name",
      "title",
      "regularHours",
      "specialHours",
      "moreHours",
      "categories",
      "metadata",
    ])
    const url = new URL(request.url)

    expect(url.pathname).toBe("/v1/locations/456")
    expect(url.searchParams.get("readMask")).toBe(
      "name,title,regularHours,specialHours,moreHours,categories,metadata"
    )
    expect(request.init.method).toBe("GET")
  })

  it("uses field masks and validateOnly for Hours preflight", () => {
    const request = googleLocationHoursPatchRequest({
      locationName: "locations/456",
      updateMask: ["regularHours", "specialHours", "moreHours"],
      validateOnly: true,
      payload: {
        regularHours: { periods: [] },
        specialHours: { specialHourPeriods: [] },
        moreHours: [],
      },
    })
    const url = new URL(request.url)

    expect(request.init.method).toBe("PATCH")
    expect(url.searchParams.get("updateMask")).toBe(
      "regularHours,specialHours,moreHours"
    )
    expect(url.searchParams.get("validateOnly")).toBe("true")
    expect(JSON.parse(String(request.init.body))).toEqual({
      name: "locations/456",
      regularHours: { periods: [] },
      specialHours: { specialHourPeriods: [] },
      moreHours: [],
    })
  })

  it("uses field masks and validateOnly for Profile preflight", () => {
    const request = googleLocationProfilePatchRequest({
      locationName: "locations/456",
      updateMask: ["title", "profile", "phoneNumbers"],
      validateOnly: true,
      payload: {
        title: "Old Crown Girton",
        profile: { description: "Local food and ales" },
        phoneNumbers: { primaryPhone: "+44 1223 000000" },
      },
    })
    const url = new URL(request.url)
    expect(request.init.method).toBe("PATCH")
    expect(url.searchParams.get("updateMask")).toBe(
      "title,profile,phoneNumbers"
    )
    expect(url.searchParams.get("validateOnly")).toBe("true")
    expect(JSON.parse(String(request.init.body))).toMatchObject({
      name: "locations/456",
      title: "Old Crown Girton",
    })
  })

  it("encodes repeated metrics and local calendar dates for Performance", () => {
    const request = googlePerformanceRequest({
      locationName: "locations/456",
      metrics: ["CALL_CLICKS", "WEBSITE_CLICKS"],
      startDate: "2026-07-01",
      endDate: "2026-07-28",
    })
    const url = new URL(request.url)

    expect(url.pathname).toBe(
      "/v1/locations/456:fetchMultiDailyMetricsTimeSeries"
    )
    expect(url.searchParams.getAll("dailyMetrics")).toEqual([
      "CALL_CLICKS",
      "WEBSITE_CLICKS",
    ])
    expect(url.searchParams.get("dailyRange.startDate.year")).toBe("2026")
    expect(url.searchParams.get("dailyRange.startDate.month")).toBe("07")
    expect(url.searchParams.get("dailyRange.startDate.day")).toBe("01")
    expect(url.searchParams.get("dailyRange.endDate.day")).toBe("28")
  })

  it("requests one exact search-keyword month with bounded pagination", () => {
    const request = googleSearchKeywordImpressionsRequest({
      locationName: "locations/456",
      month: "2026-07",
      pageToken: "next page",
    })
    const url = new URL(request.url)

    expect(url.pathname).toBe(
      "/v1/locations/456/searchkeywords/impressions/monthly"
    )
    expect(url.searchParams.get("monthlyRange.startMonth.year")).toBe("2026")
    expect(url.searchParams.get("monthlyRange.startMonth.month")).toBe("07")
    expect(url.searchParams.get("monthlyRange.endMonth.month")).toBe("07")
    expect(url.searchParams.get("pageSize")).toBe("100")
    expect(url.searchParams.get("pageToken")).toBe("next page")
  })

  it("builds Place Action list and CRUD contracts", () => {
    const list = googlePlaceActionLinksListRequest({
      locationName: "locations/456",
      pageToken: "next",
    })
    expect(new URL(list.url).pathname).toBe(
      "/v1/locations/456/placeActionLinks"
    )
    expect(new URL(list.url).searchParams.get("pageToken")).toBe("next")

    const payload = {
      uri: "https://booking.example.com/table",
      placeActionType: "DINING_RESERVATION" as const,
      isPreferred: true,
    }
    const create = googlePlaceActionLinkCreateRequest({
      locationName: "locations/456",
      payload,
    })
    expect(create.init.method).toBe("POST")
    expect(JSON.parse(String(create.init.body))).toEqual(payload)

    const patch = googlePlaceActionLinkPatchRequest({
      name: "locations/456/placeActionLinks/abc",
      payload,
    })
    expect(patch.init.method).toBe("PATCH")
    expect(new URL(patch.url).searchParams.get("updateMask")).toBe(
      "uri,placeActionType,isPreferred"
    )
    expect(JSON.parse(String(patch.init.body))).toEqual({
      name: "locations/456/placeActionLinks/abc",
      ...payload,
    })

    expect(
      googlePlaceActionLinkDeleteRequest(
        "locations/456/placeActionLinks/abc"
      ).init.method
    ).toBe("DELETE")
  })

  it("builds owner/customer media list and CRUD contracts", () => {
    const owner = googleMediaListRequest({ accountName: "accounts/1", locationName: "locations/2", customer: false })
    const customer = googleMediaListRequest({ accountName: "accounts/1", locationName: "locations/2", customer: true })
    expect(new URL(owner.url).pathname).toBe("/v4/accounts/1/locations/2/media")
    expect(new URL(customer.url).pathname).toBe("/v4/accounts/1/locations/2/media/customers")
    expect(new URL(owner.url).searchParams.get("pageSize")).toBe("2500")
    const create = googleMediaCreateRequest({ accountName: "accounts/1", locationName: "locations/2", payload: { mediaFormat: "PHOTO", locationAssociation: { category: "FOOD_AND_DRINK" }, sourceUrl: "https://images.example.com/dish.jpg", description: "Dish" } })
    expect(create.init.method).toBe("POST")
    expect(JSON.parse(String(create.init.body))).toMatchObject({ mediaFormat: "PHOTO", locationAssociation: { category: "FOOD_AND_DRINK" } })
    const update = googleMediaPatchRequest({ name: "accounts/1/locations/2/media/3", category: "INTERIOR" })
    expect(new URL(update.url).searchParams.get("updateMask")).toBe("locationAssociation.category")
    expect(googleMediaDeleteRequest("accounts/1/locations/2/media/3").init.method).toBe("DELETE")
  })

  it("builds the Food Menus full-resource read and replacement contracts", () => {
    const name = googleFoodMenusName("accounts/1", "locations/2")
    expect(name).toBe("accounts/1/locations/2/foodMenus")
    const get = googleFoodMenusGetRequest(name)
    expect(new URL(get.url).pathname).toBe(
      "/v4/accounts/1/locations/2/foodMenus"
    )
    expect(new URL(get.url).searchParams.get("readMask")).toBe("name,menus")
    const menus = [{ labels: [{ displayName: "Main", languageCode: "en-GB" }], sections: [] }]
    const patch = googleFoodMenusPatchRequest({ name, menus })
    expect(patch.init.method).toBe("PATCH")
    expect(new URL(patch.url).searchParams.get("updateMask")).toBe("menus")
    expect(JSON.parse(String(patch.init.body))).toEqual({ name, menus })
  })

  it("builds Local Posts CRUD contracts on canonical account/location names", () => {
    const list = googleLocalPostsListRequest({
      accountName: "accounts/123",
      locationName: "locations/456",
    })
    expect(new URL(list.url).pathname).toBe(
      "/v4/accounts/123/locations/456/localPosts"
    )
    expect(new URL(list.url).searchParams.get("pageSize")).toBe("100")

    const create = googleLocalPostCreateRequest({
      accountName: "accounts/123",
      locationName: "locations/456",
      payload: { topicType: "STANDARD", summary: "Hello" },
    })
    expect(create.init.method).toBe("POST")
    expect(JSON.parse(String(create.init.body))).toMatchObject({
      topicType: "STANDARD",
      summary: "Hello",
    })

    const patch = googleLocalPostPatchRequest({
      postName: "accounts/123/locations/456/localPosts/789",
      updateMask: ["summary", "scheduledTime"],
      payload: { summary: "Updated" },
    })
    expect(patch.init.method).toBe("PATCH")
    expect(new URL(patch.url).searchParams.get("updateMask")).toBe(
      "summary,scheduledTime"
    )
    expect(googleLocalPostDeleteRequest(
      "accounts/123/locations/456/localPosts/789"
    ).init.method).toBe("DELETE")
  })
})
