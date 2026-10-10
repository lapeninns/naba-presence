import {
  mutationReceiptResponseSchema,
  type MutationReceipt,
} from "@/lib/contracts/mutation-operations"

import { apiFetch, type RequestOptions } from "./client"

export type { MutationReceipt }

/**
 * `GET /api/mutations/{id}`: what became of one change, by operation id or
 * by the intent id the client sent it under.
 */
export function fetchMutationReceipt(
  id: string,
  options?: RequestOptions
): Promise<MutationReceipt> {
  return apiFetch(`/api/mutations/${encodeURIComponent(id)}`, {
    schema: mutationReceiptResponseSchema,
    ...options,
  }).then((r) => r.operation)
}
