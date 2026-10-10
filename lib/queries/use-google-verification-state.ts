"use client"

import { useQuery } from "@tanstack/react-query"
import { fetchGoogleVerificationState } from "@/lib/api/google-verification-state"
import { requestOptions } from "./request-options"

export function useGoogleVerificationState(locationId: string, enabled = true) {
  return useQuery({ queryKey: ["verification-state", locationId], enabled,
    queryFn: (context) => fetchGoogleVerificationState(locationId, requestOptions(context)),
  })
}
