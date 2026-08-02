import { z } from "zod"

import { apiFetch } from "./client"

export const googleAccountSchema = z.object({
  id: z.string(),
  googleAccountName: z.string(),
  accountName: z.string(),
  type: z.string().nullable(),
  role: z.string().nullable(),
  permissionLevel: z.string().nullable(),
  isActive: z.boolean(),
})

const accountsResponseSchema = z.object({ accounts: z.array(googleAccountSchema) })

export type GoogleAccount = z.infer<typeof googleAccountSchema>

export function fetchGoogleAccounts(connectionId?: string | null) {
  const path = connectionId
    ? `/api/google/accounts?connection_id=${encodeURIComponent(connectionId)}`
    : "/api/google/accounts"
  return apiFetch(path, { schema: accountsResponseSchema })
}

export function saveActiveAccounts(accountIds: string[]) {
  return apiFetch("/api/google/accounts", {
    method: "PATCH",
    body: { accountIds },
    schema: accountsResponseSchema,
  })
}
