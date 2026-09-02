import { apiFetch, type RequestOptions } from "./client"
import {
  googleAccountsResponseSchema,
  type AccountSelectionInput,
} from "@/lib/contracts/google"

export { googleAccountSchema, type GoogleAccount } from "@/lib/contracts/google"

export function fetchGoogleAccounts(connectionId?: string | null, options?: RequestOptions) {
  const path = connectionId
    ? `/api/google/accounts?connection_id=${encodeURIComponent(connectionId)}`
    : "/api/google/accounts"
  return apiFetch(path, { schema: googleAccountsResponseSchema, ...options })
}

export function saveActiveAccounts(accountIds: AccountSelectionInput["accountIds"]) {
  return apiFetch("/api/google/accounts", {
    method: "PATCH",
    body: { accountIds } satisfies AccountSelectionInput,
    schema: googleAccountsResponseSchema,
  })
}
