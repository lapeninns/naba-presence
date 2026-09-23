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
  /**
   * The connection being reconnected. The server looks up its Google email
   * and sends it to Google as `login_hint`, so the consent screen opens on
   * the right account instead of whichever one the browser last used.
   */
  reconnectConnectionId: z.uuid().optional(),
})
export type ConnectStartBody = z.infer<typeof connectStartBodySchema>

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
  /**
   * When Google said the refresh token itself stops working. Set only for
   * apps still in Google's "Testing" publishing status (seven days); null
   * once the OAuth app is in production.
   */
  refreshTokenExpiresAt: z.string().nullable().optional(),
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
export const disconnectResponseSchema = z.object({
  status: z.literal("disconnected"),
  // Whether Google confirmed the revoke. "failed" is never presented as
  // revoked: the grant may still be listed in the Google account.
  googleRevocation: z.enum(["revoked", "failed", "not_attempted"]).optional(),
})
export type DisconnectResponse = z.infer<typeof disconnectResponseSchema>
