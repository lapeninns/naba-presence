import type { z } from "zod"

import {
  bulkOperationListSchema,
  bulkOperationResponseSchema,
  type bulkPreviewRequestSchema,
} from "@/lib/contracts/bulk-listings"

import { apiFetch, type RequestOptions } from "./client"

const op = (path: string, body: unknown = {}) =>
  apiFetch(`/api/listings/bulk${path}`, { method: "POST", body, schema: bulkOperationResponseSchema }).then((result) => result.operation)

export const previewBulkChange = (body: z.input<typeof bulkPreviewRequestSchema>) => op("/preview", body)
export const fetchBulkChange = (id: string, options?: RequestOptions) =>
  apiFetch(`/api/listings/bulk/${id}`, { schema: bulkOperationResponseSchema, ...options }).then((result) => result.operation)
export const fetchBulkChanges = (options?: RequestOptions) => apiFetch("/api/listings/bulk", { schema: bulkOperationListSchema, ...options })
export const approveBulkChange = (id: string, expectedPreviewHash: string, acknowledgeSkipped: boolean) => op(`/${id}/approve`, { expectedPreviewHash, acknowledgeSkipped })
export const startBulkChange = (id: string) => op(`/${id}/execute`)
export const cancelBulkChange = (id: string) => op(`/${id}/cancel`)
export const retryBulkChange = (id: string) => op(`/${id}/retry`)
