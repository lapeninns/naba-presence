import { apiFetch, type RequestOptions } from "./client"
import { presenceResponseSchema } from "@/lib/contracts/analytics"

export {
  presenceResponseSchema,
  presenceStateSchema,
  type PresenceResponse,
  type PresenceStatus,
} from "@/lib/contracts/analytics"

export function fetchPresence(
  params: { range: string; locationId?: string; clientId?: string },
  options?: RequestOptions
) {
  const query = new URLSearchParams({ range: params.range })
  if (params.locationId) query.set("locationId", params.locationId)
  if (params.clientId) query.set("clientId", params.clientId)
  return apiFetch(`/api/analytics/presence?${query}`, {
    schema: presenceResponseSchema,
    ...options,
  })
}
