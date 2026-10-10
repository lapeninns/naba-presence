import { verificationWorkflowResponseSchema, type VerificationWorkflowQuery } from "@/lib/contracts/google-verification-workflows"
import { apiFetch, type RequestOptions } from "./client"

export function fetchGoogleVerificationWorkflows(locationId: string, query: Partial<VerificationWorkflowQuery> = {}, options?: RequestOptions) {
  const params = new URLSearchParams()
  if (query.operation) params.set("operation", query.operation)
  if (query.stage) params.set("stage", query.stage)
  if (query.includeExpired) params.set("includeExpired", query.includeExpired)
  if (query.pageSize) params.set("pageSize", String(query.pageSize))
  if (query.cursor) params.set("cursor", query.cursor)
  return apiFetch(`/api/locations/${locationId}/verification-workflows?${params}`, { ...options, schema: verificationWorkflowResponseSchema })
}
