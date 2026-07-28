export function googleAccountsRequest(pageToken?: string) {
  const params = new URLSearchParams({ pageSize: "20" })
  if (pageToken) params.set("pageToken", pageToken)
  return {
    url: `https://mybusinessaccountmanagement.googleapis.com/v1/accounts?${params}`,
    init: { method: "GET" },
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
  pubsubTopic: string
) {
  return {
    url: `https://mybusinessnotifications.googleapis.com/v1/${accountName}/notificationSetting?updateMask=pubsubTopic,notificationTypes`,
    init: {
      method: "PATCH",
      body: JSON.stringify({
        name: `${accountName}/notificationSetting`,
        pubsubTopic,
        notificationTypes: pubsubTopic ? ["NEW_REVIEW", "UPDATED_REVIEW"] : [],
      }),
    } satisfies RequestInit,
  }
}
