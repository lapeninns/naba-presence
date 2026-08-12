import "server-only"

import {
  googleAccountManagementRequest,
  googleBusinessCallsRequest,
  googleHealthcareRequest,
  googleLodgingRequest,
  googleLocationProfilePatchRequest,
  googleVerificationRequest,
} from "@/lib/domain/google-contract"
import { googleRequest } from "./transport"

export function googleVerificationApi(
  accessToken: string,
  input: {
    path: string
    method?: "GET" | "POST"
    payload?: Record<string, unknown>
  },
  options: { connectionKey?: string; mutation?: boolean } = {}
) {
  const request = googleVerificationRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    {
      connectionKey: options.connectionKey,
      mode: options.mutation ? "mutation" : "safe",
    }
  )
}

export function googleAccountManagementApi(
  accessToken: string,
  input: {
    path: string
    method?: "GET" | "POST" | "PATCH" | "DELETE"
    payload?: Record<string, unknown>
    updateMask?: string[]
  },
  options: { connectionKey?: string; mutation?: boolean } = {}
) {
  const request = googleAccountManagementRequest(input)
  return googleRequest<Record<string, unknown> | null>(
    request.url,
    accessToken,
    request.init,
    {
      connectionKey: options.connectionKey,
      mode: options.mutation ? "mutation" : "safe",
    }
  )
}

export function googleLodgingApi(
  accessToken: string,
  input: {
    locationName: string
    operation: "get" | "getGoogleUpdated" | "patch"
    updateMask?: string[]
    payload?: Record<string, unknown>
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleLodgingRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    {
      ...options,
      mode: input.operation === "patch" ? "mutation" : "safe",
    }
  )
}

export function googleBusinessCallsApi(
  accessToken: string,
  input: {
    locationName: string
    operation: "settings" | "patch" | "insights"
    updateMask?: string[]
    payload?: Record<string, unknown>
    filter?: string
    pageToken?: string
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleBusinessCallsRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    {
      ...options,
      mode: input.operation === "patch" ? "mutation" : "safe",
    }
  )
}

export function googleHealthcareApi(
  accessToken: string,
  input: {
    accountName: string
    locationName: string
    resource: "serviceList" | "healthProviderAttributes" | "insuranceNetworks"
    method?: "GET" | "PATCH"
    updateMask?: string[]
    payload?: Record<string, unknown>
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleHealthcareRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    {
      ...options,
      mode: input.method === "PATCH" ? "mutation" : "safe",
    }
  )
}

export function patchGoogleLocationProfile(
  accessToken: string,
  input: {
    locationName: string
    updateMask: Array<"title" | "profile" | "phoneNumbers" | "websiteUri">
    validateOnly: boolean
    payload: Record<string, unknown>
  },
  options: { connectionKey?: string; timeoutMs?: number } = {}
) {
  const request = googleLocationProfilePatchRequest(input)
  return googleRequest<Record<string, unknown> | null>(
    request.url,
    accessToken,
    request.init,
    {
      connectionKey: options.connectionKey,
      mode: input.validateOnly ? "safe" : "mutation",
      timeoutMs: options.timeoutMs,
    }
  )
}
