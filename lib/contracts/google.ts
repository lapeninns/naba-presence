/**
 * Wire contract for `/api/google/accounts` and `/api/google/locations`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. The accounts
 * route parses its PATCH body with `accountSelectionSchema`;
 * `lib/api/google-accounts.ts` and `lib/api/google-locations.ts` parse
 * responses with the response schemas.
 */
import { z } from "zod"

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** PATCH `/api/google/accounts` body. */
export const accountSelectionSchema = z.object({
  accountIds: z.array(z.uuid()).max(100),
  /**
   * The selection replaces the active set only among the accounts this scope
   * reaches: a client's logins when `clientId` is given, one login when
   * `connectionId` is. Without either it spans the organisation, which is
   * what used to switch off every other client's accounts from setup.
   */
  clientId: z.uuid().optional(),
  connectionId: z.uuid().optional(),
})
export type AccountSelectionInput = z.infer<typeof accountSelectionSchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const googleAccountSchema = z.object({
  id: z.string(),
  googleAccountName: z.string(),
  accountName: z.string(),
  type: z.string().nullable(),
  role: z.string().nullable(),
  permissionLevel: z.string().nullable(),
  isActive: z.boolean(),
  /** The login this account is reached through. */
  googleConnectionId: z.string().nullable().optional(),
})
export type GoogleAccount = z.infer<typeof googleAccountSchema>

/** GET and PATCH `/api/google/accounts` response. */
export const googleAccountsResponseSchema = z.object({
  accounts: z.array(googleAccountSchema),
})
export type GoogleAccountsResponse = z.infer<typeof googleAccountsResponseSchema>

export const discoveredLocationSchema = z.object({
  id: z.string(),
  accountName: z.string(),
  googleLocationName: z.string(),
  title: z.string(),
  address: z.string(),
  verified: z.boolean(),
})
export type DiscoveredLocation = z.infer<typeof discoveredLocationSchema>

/** GET `/api/google/locations` response. */
export const googleLocationsResponseSchema = z.object({
  locations: z.array(discoveredLocationSchema),
})
export type GoogleLocationsResponse = z.infer<typeof googleLocationsResponseSchema>
