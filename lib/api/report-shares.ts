import {
  reportShareCreatedResponseSchema,
  reportShareRevokedResponseSchema,
  reportSharesResponseSchema,
  type ReportShareCreateInput,
} from "@/lib/contracts/report-shares"

import { apiFetch } from "./client"

export { type ReportShare } from "@/lib/contracts/report-shares"

export function fetchReportShares(clientId: string, signal?: AbortSignal) {
  return apiFetch(`/api/clients/${clientId}/report-shares`, {
    schema: reportSharesResponseSchema,
    signal,
  })
}

export function createReportShare(
  clientId: string,
  input: ReportShareCreateInput
) {
  return apiFetch(`/api/clients/${clientId}/report-shares`, {
    method: "POST",
    body: input,
    schema: reportShareCreatedResponseSchema,
  })
}

export function revokeReportShare(clientId: string, shareId: string) {
  return apiFetch(`/api/clients/${clientId}/report-shares/${shareId}`, {
    method: "DELETE",
    schema: reportShareRevokedResponseSchema,
  })
}
