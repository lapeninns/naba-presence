import "server-only"

import {
  googleBatchReviewsRequest,
  googleReplyRequest,
} from "@/lib/domain/google-contract"
import { googleRequest } from "./transport"

export function googleReviews(
  accessToken: string,
  accountName: string,
  locationName: string,
  pageToken?: string,
  options: { connectionKey?: string } = {}
) {
  const params = new URLSearchParams({
    pageSize: "50",
    orderBy: "updateTime desc",
  })
  if (pageToken) params.set("pageToken", pageToken)
  const locationId = locationName.replace(/^locations\//, "")
  return googleRequest<{
    reviews?: Array<Record<string, unknown>>
    nextPageToken?: string
    averageRating?: number
    totalReviewCount?: number
  }>(
    `https://mybusiness.googleapis.com/v4/${accountName}/locations/${locationId}/reviews?${params}`,
    accessToken,
    {},
    options
  )
}

export function googleBatchReviews(
  accessToken: string,
  accountName: string,
  locationNames: string[],
  pageToken?: string,
  options: { connectionKey?: string } = {}
) {
  const request = googleBatchReviewsRequest(
    accountName,
    locationNames,
    pageToken
  )
  return googleRequest<{
    locationReviews?: Array<{
      name?: string
      review?: Record<string, unknown>
    }>
    nextPageToken?: string
  }>(request.url, accessToken, request.init, options)
}

export function updateGoogleReply(
  accessToken: string,
  reviewName: string,
  body: string,
  options: { connectionKey?: string; timeoutMs?: number } = {}
) {
  const request = googleReplyRequest(reviewName, body)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    {
      connectionKey: options.connectionKey,
      mode: "mutation",
      timeoutMs: options.timeoutMs,
    }
  )
}

export function getGoogleReview(
  accessToken: string,
  reviewName: string,
  options: {
    connectionKey?: string
    timeoutMs?: number
    maxAttempts?: number
  } = {}
) {
  return googleRequest<Record<string, unknown>>(
    `https://mybusiness.googleapis.com/v4/${reviewName}`,
    accessToken,
    {},
    {
      connectionKey: options.connectionKey,
      timeoutMs: options.timeoutMs,
      maxAttempts: options.maxAttempts,
    }
  )
}

export function deleteGoogleReply(
  accessToken: string,
  reviewName: string,
  options: { connectionKey?: string; timeoutMs?: number } = {}
) {
  return googleRequest<Record<string, never>>(
    `https://mybusiness.googleapis.com/v4/${reviewName}/reply`,
    accessToken,
    { method: "DELETE" },
    {
      connectionKey: options.connectionKey,
      mode: "mutation",
      timeoutMs: options.timeoutMs,
    }
  )
}
