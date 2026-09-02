import { apiFetch, type RequestOptions } from "./client"
import { sessionResponseSchema } from "@/lib/contracts/session"

export {
  sessionResponseSchema,
  sessionSchema,
  type SessionResponse,
  type SessionUser,
} from "@/lib/contracts/session"

export function fetchSession(options?: RequestOptions) {
  return apiFetch("/api/session", { schema: sessionResponseSchema, ...options })
}
