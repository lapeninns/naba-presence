/**
 * Wire contract for `/api/google/connections/**` and
 * `/api/google/connect/start`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. Shared by the
 * routes (params/body schemas), `lib/api/connections.ts` (response schemas)
 * and `lib/server/connections.ts` (the `ConnectionSummary` row projection).
 */
import { z } from "zod"

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** POST `/api/google/connect/start` body (intentionally empty). */
export const connectStartBodySchema = z.object({
  /**
   * Which client this connection is being made for. Carried through Google's
   * round trip in the signed state so the callback can file the discovered
   * location under the right client and return the operator to the step they
   * left, instead of dropping them on a settings page with no context.
   */
  clientId: z.uuid().optional(),
  /**
   * Where to send the browser afterwards. Validated against an allow-list on
   * the server — a user-supplied redirect that survives an OAuth round trip is
   * an open redirect if it is not.
   */
  returnTo: z.string().max(200).optional(),
})

/** POST `/api/google/connections/[id]/disconnect` params. */
export const disconnectParamsSchema = z.object({ id: z.string() })

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const connectionSummarySchema = z.object({
  id: z.string(),
  googleEmail: z.string().nullable(),
  status: z.string(),
  scope: z.string().optional(),
  notificationsEnabled: z.boolean(),
  lastRefreshAt: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  reconnectRequired: z.boolean(),
  createdAt: z.string(),
})
export type ConnectionSummary = z.infer<typeof connectionSummarySchema>

/** GET `/api/google/connections` response. */
export const connectionsResponseSchema = z.object({
  connections: z.array(connectionSummarySchema),
})
export type ConnectionsResponse = z.infer<typeof connectionsResponseSchema>

/** POST `/api/google/connect/start` response. */
export const connectStartResponseSchema = z.object({ authorizationUrl: z.string() })
export type ConnectStartResponse = z.infer<typeof connectStartResponseSchema>

/** POST `/api/google/connections/[id]/disconnect` response. */
export const disconnectResponseSchema = z.object({ status: z.literal("disconnected") })
export type DisconnectResponse = z.infer<typeof disconnectResponseSchema>
