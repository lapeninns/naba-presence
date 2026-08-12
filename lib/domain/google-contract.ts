export function googleAccountsRequest(pageToken?: string) {
  const params = new URLSearchParams({ pageSize: "20" })
  if (pageToken) params.set("pageToken", pageToken)
  return {
    url: `https://mybusinessaccountmanagement.googleapis.com/v1/accounts?${params}`,
    init: { method: "GET" },
  } satisfies { url: string; init: RequestInit }
}

export type GoogleLocationReadField =
  | "name"
  | "title"
  | "phoneNumbers"
  | "profile"
  | "storefrontAddress"
  | "websiteUri"
  | "regularHours"
  | "specialHours"
  | "moreHours"
  | "categories"
  | "metadata"
  | "serviceArea"
  | "storeCode"
  | "openInfo"
  | "relationshipData"
  | "serviceItems"
  | "labels"

export type GoogleHoursUpdateMask =
  | "regularHours"
  | "specialHours"
  | "moreHours"

export const GOOGLE_PERFORMANCE_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "BUSINESS_CONVERSATIONS",
  "BUSINESS_BOOKINGS",
  "BUSINESS_FOOD_ORDERS",
  "BUSINESS_FOOD_MENU_CLICKS",
] as const

export type GooglePerformanceMetric =
  (typeof GOOGLE_PERFORMANCE_METRICS)[number]

export function googlePerformanceRequest(input: {
  locationName: string
  metrics: readonly GooglePerformanceMetric[]
  startDate: string
  endDate: string
}) {
  if (!input.metrics.length) {
    throw new RangeError("Google performance requests require metrics.")
  }
  const params = new URLSearchParams()
  for (const metric of input.metrics) params.append("dailyMetrics", metric)
  const [startYear, startMonth, startDay] = input.startDate.split("-")
  const [endYear, endMonth, endDay] = input.endDate.split("-")
  params.set("dailyRange.startDate.year", startYear ?? "")
  params.set("dailyRange.startDate.month", startMonth ?? "")
  params.set("dailyRange.startDate.day", startDay ?? "")
  params.set("dailyRange.endDate.year", endYear ?? "")
  params.set("dailyRange.endDate.month", endMonth ?? "")
  params.set("dailyRange.endDate.day", endDay ?? "")
  return {
    url: `https://businessprofileperformance.googleapis.com/v1/${input.locationName}:fetchMultiDailyMetricsTimeSeries?${params}`,
    init: { method: "GET" },
  } satisfies { url: string; init: RequestInit }
}

export function googleSearchKeywordImpressionsRequest(input: {
  locationName: string
  month: string
  pageToken?: string
}) {
  const [year, month] = input.month.split("-")
  const params = new URLSearchParams({
    "monthlyRange.startMonth.year": year ?? "",
    "monthlyRange.startMonth.month": month ?? "",
    "monthlyRange.endMonth.year": year ?? "",
    "monthlyRange.endMonth.month": month ?? "",
    pageSize: "100",
  })
  if (input.pageToken) params.set("pageToken", input.pageToken)
  return {
    url: `https://businessprofileperformance.googleapis.com/v1/${input.locationName}/searchkeywords/impressions/monthly?${params}`,
    init: { method: "GET" },
  } satisfies { url: string; init: RequestInit }
}

export const GOOGLE_PLACE_ACTION_TYPES = [
  "APPOINTMENT",
  "ONLINE_APPOINTMENT",
  "DINING_RESERVATION",
  "FOOD_ORDERING",
  "FOOD_DELIVERY",
  "FOOD_TAKEOUT",
  "SHOP_ONLINE",
] as const

export type GooglePlaceActionType =
  (typeof GOOGLE_PLACE_ACTION_TYPES)[number]

export const GOOGLE_MEDIA_CATEGORIES = [
  "COVER",
  "PROFILE",
  "LOGO",
  "EXTERIOR",
  "INTERIOR",
  "PRODUCT",
  "AT_WORK",
  "FOOD_AND_DRINK",
  "MENU",
  "COMMON_AREA",
  "ROOMS",
  "TEAMS",
  "ADDITIONAL",
] as const

export type GoogleMediaCategory =
  (typeof GOOGLE_MEDIA_CATEGORIES)[number]

export const GOOGLE_NOTIFICATION_TYPES = [
  "GOOGLE_UPDATE",
  "NEW_REVIEW",
  "UPDATED_REVIEW",
  "NEW_CUSTOMER_MEDIA",
  "DUPLICATE_LOCATION",
  "VOICE_OF_MERCHANT_UPDATED",
] as const

export type GoogleNotificationType =
  (typeof GOOGLE_NOTIFICATION_TYPES)[number]

export function googlePlaceActionLinksListRequest(input: {
  locationName: string
  pageToken?: string
}) {
  const params = new URLSearchParams({ pageSize: "100" })
  if (input.pageToken) params.set("pageToken", input.pageToken)
  return {
    url: `https://mybusinessplaceactions.googleapis.com/v1/${input.locationName}/placeActionLinks?${params}`,
    init: { method: "GET" },
  } satisfies { url: string; init: RequestInit }
}

export function googlePlaceActionLinkCreateRequest(input: {
  locationName: string
  payload: {
    uri: string
    placeActionType: GooglePlaceActionType
    isPreferred: boolean
  }
}) {
  return {
    url: `https://mybusinessplaceactions.googleapis.com/v1/${input.locationName}/placeActionLinks`,
    init: { method: "POST", body: JSON.stringify(input.payload) },
  } satisfies { url: string; init: RequestInit }
}

export function googlePlaceActionLinkGetRequest(name: string) {
  return {
    url: `https://mybusinessplaceactions.googleapis.com/v1/${name}`,
    init: { method: "GET" },
  } satisfies { url: string; init: RequestInit }
}

export function googlePlaceActionLinkPatchRequest(input: {
  name: string
  payload: {
    uri: string
    placeActionType: GooglePlaceActionType
    isPreferred: boolean
  }
}) {
  const params = new URLSearchParams({
    updateMask: "uri,placeActionType,isPreferred",
  })
  return {
    url: `https://mybusinessplaceactions.googleapis.com/v1/${input.name}?${params}`,
    init: {
      method: "PATCH",
      body: JSON.stringify({ name: input.name, ...input.payload }),
    },
  } satisfies { url: string; init: RequestInit }
}

export function googlePlaceActionLinkDeleteRequest(name: string) {
  return {
    url: `https://mybusinessplaceactions.googleapis.com/v1/${name}`,
    init: { method: "DELETE" },
  } satisfies { url: string; init: RequestInit }
}

function googleLocalPostParent(accountName: string, locationName: string) {
  if (locationName.startsWith(`${accountName}/`)) return locationName
  const locationId = locationName.replace(/^locations\//, "")
  return `${accountName}/locations/${locationId}`
}

export function googleMediaListRequest(input: {
  accountName: string
  locationName: string
  customer: boolean
  pageToken?: string
}) {
  const params = new URLSearchParams({ pageSize: "100" })
  if (input.pageToken) params.set("pageToken", input.pageToken)
  const suffix = input.customer ? "/media/customers" : "/media"
  return {
    url: `https://mybusiness.googleapis.com/v4/${googleLocalPostParent(input.accountName, input.locationName)}${suffix}?${params}`,
    init: { method: "GET" },
  } satisfies { url: string; init: RequestInit }
}

export function googleMediaCreateRequest(input: {
  accountName: string
  locationName: string
  payload: {
    mediaFormat: "PHOTO" | "VIDEO"
    locationAssociation: { category: GoogleMediaCategory }
    sourceUrl?: string
    dataRef?: { resourceName: string }
    description?: string
  }
}) {
  return {
    url: `https://mybusiness.googleapis.com/v4/${googleLocalPostParent(input.accountName, input.locationName)}/media`,
    init: { method: "POST", body: JSON.stringify(input.payload) },
  } satisfies { url: string; init: RequestInit }
}

export function googleMediaGetRequest(name: string) {
  return {
    url: `https://mybusiness.googleapis.com/v4/${name}`,
    init: { method: "GET" },
  } satisfies { url: string; init: RequestInit }
}

export function googleMediaPatchRequest(input: {
  name: string
  category: GoogleMediaCategory
}) {
  const params = new URLSearchParams({
    updateMask: "locationAssociation.category",
  })
  return {
    url: `https://mybusiness.googleapis.com/v4/${input.name}?${params}`,
    init: {
      method: "PATCH",
      body: JSON.stringify({
        name: input.name,
        locationAssociation: { category: input.category },
      }),
    },
  } satisfies { url: string; init: RequestInit }
}

export function googleMediaDeleteRequest(name: string) {
  return {
    url: `https://mybusiness.googleapis.com/v4/${name}`,
    init: { method: "DELETE" },
  } satisfies { url: string; init: RequestInit }
}

export function googleFoodMenusName(accountName: string, locationName: string) {
  return `${googleLocalPostParent(accountName, locationName)}/foodMenus`
}

export function googleFoodMenusGetRequest(name: string) {
  const params = new URLSearchParams({ readMask: "name,menus" })
  return {
    url: `https://mybusiness.googleapis.com/v4/${name}?${params}`,
    init: { method: "GET" },
  } satisfies { url: string; init: RequestInit }
}

export function googleFoodMenusPatchRequest(input: {
  name: string
  menus: Array<Record<string, unknown>>
}) {
  const params = new URLSearchParams({ updateMask: "menus" })
  return {
    url: `https://mybusiness.googleapis.com/v4/${input.name}?${params}`,
    init: {
      method: "PATCH",
      body: JSON.stringify({ name: input.name, menus: input.menus }),
    },
  } satisfies { url: string; init: RequestInit }
}

export function googleLocalPostsListRequest(input: {
  accountName: string
  locationName: string
  pageToken?: string
}) {
  const params = new URLSearchParams({ pageSize: "100" })
  if (input.pageToken) params.set("pageToken", input.pageToken)
  return {
    url: `https://mybusiness.googleapis.com/v4/${googleLocalPostParent(input.accountName, input.locationName)}/localPosts?${params}`,
    init: { method: "GET" },
  } satisfies { url: string; init: RequestInit }
}

export function googleLocalPostCreateRequest(input: {
  accountName: string
  locationName: string
  payload: Record<string, unknown>
}) {
  return {
    url: `https://mybusiness.googleapis.com/v4/${googleLocalPostParent(input.accountName, input.locationName)}/localPosts`,
    init: { method: "POST", body: JSON.stringify(input.payload) },
  } satisfies { url: string; init: RequestInit }
}

export function googleLocalPostGetRequest(postName: string) {
  return {
    url: `https://mybusiness.googleapis.com/v4/${postName}`,
    init: { method: "GET" },
  } satisfies { url: string; init: RequestInit }
}

export function googleLocalPostPatchRequest(input: {
  postName: string
  updateMask: string[]
  payload: Record<string, unknown>
}) {
  const params = new URLSearchParams({ updateMask: input.updateMask.join(",") })
  return {
    url: `https://mybusiness.googleapis.com/v4/${input.postName}?${params}`,
    init: {
      method: "PATCH",
      body: JSON.stringify({ name: input.postName, ...input.payload }),
    },
  } satisfies { url: string; init: RequestInit }
}

export function googleLocalPostDeleteRequest(postName: string) {
  return {
    url: `https://mybusiness.googleapis.com/v4/${postName}`,
    init: { method: "DELETE" },
  } satisfies { url: string; init: RequestInit }
}

export function googleLocationRequest(
  locationName: string,
  readMask: GoogleLocationReadField[]
) {
  const params = new URLSearchParams({ readMask: readMask.join(",") })
  return {
    url: `https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}?${params}`,
    init: { method: "GET" },
  } satisfies { url: string; init: RequestInit }
}

export function googleMediaStartUploadRequest(input: {
  accountName: string
  locationName: string
}) {
  return {
    url: `https://mybusiness.googleapis.com/v4/${input.accountName}/${input.locationName}/media:startUpload`,
    init: { method: "POST", body: JSON.stringify({}) },
  } satisfies { url: string; init: RequestInit }
}

export function googleMediaBinaryUploadRequest(input: {
  resourceName: string
  bytes: ArrayBuffer
  contentType: string
}) {
  const params = new URLSearchParams({ uploadType: "media" })
  return {
    url: `https://mybusiness.googleapis.com/upload/v1/media/${encodeURIComponent(input.resourceName)}?${params}`,
    init: {
      method: "POST",
      headers: { "content-type": input.contentType },
      body: input.bytes,
    },
  } satisfies { url: string; init: RequestInit }
}

export function googleLocationHoursPatchRequest(input: {
  locationName: string
  updateMask: GoogleHoursUpdateMask[]
  validateOnly: boolean
  payload: Record<string, unknown>
}) {
  const params = new URLSearchParams({
    updateMask: input.updateMask.join(","),
    validateOnly: String(input.validateOnly),
  })
  return {
    url: `https://mybusinessbusinessinformation.googleapis.com/v1/${input.locationName}?${params}`,
    init: {
      method: "PATCH",
      body: JSON.stringify({ name: input.locationName, ...input.payload }),
    },
  } satisfies { url: string; init: RequestInit }
}

export function googleLocationProfilePatchRequest(input: {
  locationName: string
  updateMask: Array<"title" | "profile" | "phoneNumbers" | "websiteUri">
  validateOnly: boolean
  payload: Record<string, unknown>
}) {
  const params = new URLSearchParams({
    updateMask: input.updateMask.join(","),
    validateOnly: String(input.validateOnly),
  })
  return {
    url: `https://mybusinessbusinessinformation.googleapis.com/v1/${input.locationName}?${params}`,
    init: {
      method: "PATCH",
      body: JSON.stringify({ name: input.locationName, ...input.payload }),
    },
  } satisfies { url: string; init: RequestInit }
}

export function googleLocationPatchRequest(input: {
  locationName: string
  updateMask: string[]
  validateOnly: boolean
  payload: Record<string, unknown>
}) {
  const params = new URLSearchParams({
    updateMask: input.updateMask.join(","),
    validateOnly: String(input.validateOnly),
  })
  return {
    url: `https://mybusinessbusinessinformation.googleapis.com/v1/${input.locationName}?${params}`,
    init: {
      method: "PATCH",
      body: JSON.stringify({ name: input.locationName, ...input.payload }),
    },
  } satisfies { url: string; init: RequestInit }
}

export function googleLocationAttributesRequest(locationName: string) {
  return {
    url: `https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}/attributes`,
    init: { method: "GET" },
  } satisfies { url: string; init: RequestInit }
}

export function googleLocationAttributesPatchRequest(input: {
  locationName: string
  attributeMask: string[]
  attributes: Array<Record<string, unknown>>
}) {
  const name = `${input.locationName}/attributes`
  const params = new URLSearchParams({
    attributeMask: input.attributeMask.join(","),
  })
  return {
    url: `https://mybusinessbusinessinformation.googleapis.com/v1/${name}?${params}`,
    init: {
      method: "PATCH",
      body: JSON.stringify({ name, attributes: input.attributes }),
    },
  } satisfies { url: string; init: RequestInit }
}

export function googleAttributeMetadataRequest(input: {
  locationName: string
  languageCode?: string
  pageToken?: string
}) {
  const params = new URLSearchParams({
    parent: input.locationName,
    pageSize: "200",
  })
  if (input.languageCode) params.set("languageCode", input.languageCode)
  if (input.pageToken) params.set("pageToken", input.pageToken)
  return {
    url: `https://mybusinessbusinessinformation.googleapis.com/v1/attributes?${params}`,
    init: { method: "GET" },
  } satisfies { url: string; init: RequestInit }
}

export function googleCategoriesRequest(input: {
  regionCode: string
  languageCode: string
  query?: string
  pageToken?: string
}) {
  const params = new URLSearchParams({
    regionCode: input.regionCode,
    languageCode: input.languageCode,
    view: "FULL",
    pageSize: "100",
  })
  if (input.query) params.set("filter", `displayName=${input.query}`)
  if (input.pageToken) params.set("pageToken", input.pageToken)
  return {
    url: `https://mybusinessbusinessinformation.googleapis.com/v1/categories?${params}`,
    init: { method: "GET" },
  } satisfies { url: string; init: RequestInit }
}

export function googleChainsSearchRequest(query: string) {
  const params = new URLSearchParams({ chainName: query, pageSize: "100" })
  return {
    url: `https://mybusinessbusinessinformation.googleapis.com/v1/chains:search?${params}`,
    init: { method: "GET" },
  } satisfies { url: string; init: RequestInit }
}

export function googleLocationCreateRequest(input: {
  accountName: string
  requestId: string
  validateOnly: boolean
  payload: Record<string, unknown>
}) {
  const params = new URLSearchParams({
    requestId: input.requestId,
    validateOnly: String(input.validateOnly),
  })
  return {
    url: `https://mybusinessbusinessinformation.googleapis.com/v1/${input.accountName}/locations?${params}`,
    init: { method: "POST", body: JSON.stringify(input.payload) },
  } satisfies { url: string; init: RequestInit }
}

export function googleLocationDeleteRequest(locationName: string) {
  return {
    url: `https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}`,
    init: { method: "DELETE" },
  } satisfies { url: string; init: RequestInit }
}

export function googleLocationUpdatedRequest(
  locationName: string,
  readMask: string[]
) {
  const params = new URLSearchParams({ readMask: readMask.join(",") })
  return {
    url: `https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}:getGoogleUpdated?${params}`,
    init: { method: "GET" },
  } satisfies { url: string; init: RequestInit }
}

export function googleLocationsSearchRequest(payload: Record<string, unknown>) {
  return {
    url: "https://mybusinessbusinessinformation.googleapis.com/v1/googleLocations:search",
    init: { method: "POST", body: JSON.stringify(payload) },
  } satisfies { url: string; init: RequestInit }
}

export function googleVerificationRequest(input: {
  path: string
  method?: "GET" | "POST"
  payload?: Record<string, unknown>
}) {
  return {
    url: `https://mybusinessverifications.googleapis.com/v1/${input.path}`,
    init: {
      method: input.method ?? "GET",
      ...(input.payload ? { body: JSON.stringify(input.payload) } : {}),
    },
  } satisfies { url: string; init: RequestInit }
}

export function googleAccountManagementRequest(input: {
  path: string
  method?: "GET" | "POST" | "PATCH" | "DELETE"
  payload?: Record<string, unknown>
  updateMask?: string[]
}) {
  const params = new URLSearchParams()
  if (input.updateMask?.length) {
    params.set("updateMask", input.updateMask.join(","))
  }
  const query = params.size ? `?${params}` : ""
  return {
    url: `https://mybusinessaccountmanagement.googleapis.com/v1/${input.path}${query}`,
    init: {
      method: input.method ?? "GET",
      ...(input.payload ? { body: JSON.stringify(input.payload) } : {}),
    },
  } satisfies { url: string; init: RequestInit }
}

export function googleLodgingRequest(input: {
  locationName: string
  operation: "get" | "getGoogleUpdated" | "patch"
  updateMask?: string[]
  payload?: Record<string, unknown>
}) {
  const name = `${input.locationName}/lodging`
  const params = new URLSearchParams()
  if (input.operation !== "patch") params.set("readMask", "*")
  if (input.updateMask?.length) params.set("updateMask", input.updateMask.join(","))
  const suffix = input.operation === "getGoogleUpdated" ? ":getGoogleUpdated" : ""
  return {
    url: `https://mybusinesslodging.googleapis.com/v1/${name}${suffix}?${params}`,
    init: {
      method: input.operation === "patch" ? "PATCH" : "GET",
      ...(input.payload
        ? { body: JSON.stringify({ name, ...input.payload }) }
        : {}),
    },
  } satisfies { url: string; init: RequestInit }
}

export function googleBusinessCallsRequest(input: {
  locationName: string
  operation: "settings" | "patch" | "insights"
  updateMask?: string[]
  payload?: Record<string, unknown>
  filter?: string
  pageToken?: string
}) {
  const settingsName = `${input.locationName}/businesscallssettings`
  const params = new URLSearchParams()
  if (input.updateMask?.length) params.set("updateMask", input.updateMask.join(","))
  if (input.filter) params.set("filter", input.filter)
  if (input.pageToken) params.set("pageToken", input.pageToken)
  if (input.operation === "insights") params.set("pageSize", "100")
  const path = input.operation === "insights"
    ? `${input.locationName}/businesscallsinsights`
    : settingsName
  return {
    url: `https://mybusinessbusinesscalls.googleapis.com/v1/${path}?${params}`,
    init: {
      method: input.operation === "patch" ? "PATCH" : "GET",
      ...(input.payload
        ? { body: JSON.stringify({ name: settingsName, ...input.payload }) }
        : {}),
    },
  } satisfies { url: string; init: RequestInit }
}

export function googleHealthcareRequest(input: {
  accountName: string
  locationName: string
  resource: "serviceList" | "healthProviderAttributes" | "insuranceNetworks"
  method?: "GET" | "PATCH"
  updateMask?: string[]
  payload?: Record<string, unknown>
}) {
  const parent = `${input.accountName}/${input.locationName}`
  const name = `${parent}/${input.resource}`
  const params = new URLSearchParams()
  if (input.resource !== "serviceList") params.set("languageCode", "en")
  if (input.resource === "insuranceNetworks") params.set("pageSize", "10000")
  if (input.updateMask?.length) params.set("updateMask", input.updateMask.join(","))
  return {
    url: `https://mybusiness.googleapis.com/v4/${name}?${params}`,
    init: {
      method: input.method ?? "GET",
      ...(input.payload
        ? { body: JSON.stringify({ name, ...input.payload }) }
        : {}),
    },
  } satisfies { url: string; init: RequestInit }
}

export function googleBatchReviewsRequest(
  accountName: string,
  locationNames: string[],
  pageToken?: string
) {
  if (!locationNames.length || locationNames.length > 50) {
    throw new RangeError("Google batch review requests require 1–50 locations.")
  }
  return {
    url: `https://mybusiness.googleapis.com/v4/${accountName}/locations:batchGetReviews`,
    init: {
      method: "POST",
      body: JSON.stringify({
        locationNames: locationNames.map((locationName) =>
          locationName.startsWith("accounts/")
            ? locationName
            : `${accountName}/${locationName}`
        ),
        pageSize: 50,
        pageToken,
        orderBy: "updateTime desc",
      }),
    } satisfies RequestInit,
  }
}

export function googleReplyRequest(reviewName: string, body: string) {
  return {
    url: `https://mybusiness.googleapis.com/v4/${reviewName}/reply`,
    init: { method: "PUT", body: JSON.stringify({ comment: body }) },
  } satisfies { url: string; init: RequestInit }
}

export function googleNotificationSettingRequest(
  accountName: string,
  pubsubTopic: string,
  notificationTypes: readonly GoogleNotificationType[]
) {
  return {
    url: `https://mybusinessnotifications.googleapis.com/v1/${accountName}/notificationSetting?updateMask=pubsubTopic,notificationTypes`,
    init: {
      method: "PATCH",
      body: JSON.stringify({
        name: `${accountName}/notificationSetting`,
        pubsubTopic,
        notificationTypes: pubsubTopic ? notificationTypes : [],
      }),
    } satisfies RequestInit,
  }
}
