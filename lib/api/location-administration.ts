import { z } from "zod"

import { apiFetch, type RequestOptions } from "./client"

const sectionResultSchema = z.object({ data: z.unknown(), error: z.string().nullable() })
export type SectionResult<T = unknown> = { data: T; error: string | null }

const administrationStateSchema = z.object({
  voice: sectionResultSchema,
  verifications: sectionResultSchema,
  verificationOptions: sectionResultSchema,
  googleUpdated: sectionResultSchema,
  locationAdmins: sectionResultSchema,
  accountAdmins: sectionResultSchema,
  invitations: sectionResultSchema,
  accountName: z.string(),
  googleLocationName: z.string(),
  canManage: z.boolean(),
  writesEnabled: z.boolean(),
})
export type AdministrationState = z.infer<typeof administrationStateSchema>

export type AdministrationOperation =
  | "start_verification" | "complete_verification" | "create_admin" | "update_admin" | "delete_admin"
  | "accept_invitation" | "decline_invitation" | "transfer_location" | "create_location" | "delete_location"
  | "accept_google_update"

// Transcribed EXACTLY from app/api/locations/[id]/administration/route.ts CONFIRMATIONS.
export const ADMINISTRATION_CONFIRMATIONS: Record<AdministrationOperation, string> = {
  start_verification: "start_google_location_verification",
  complete_verification: "complete_google_location_verification",
  create_admin: "invite_google_administrator",
  update_admin: "change_google_administrator_role",
  delete_admin: "remove_google_administrator",
  accept_invitation: "accept_google_invitation",
  decline_invitation: "decline_google_invitation",
  transfer_location: "transfer_google_location",
  create_location: "create_google_location",
  delete_location: "delete_google_location_permanently",
  accept_google_update: "accept_google_suggested_update",
}

export const DANGER_ZONE_OPERATIONS: ReadonlySet<AdministrationOperation> = new Set([
  "delete_admin", "transfer_location", "delete_location",
])

export function fetchAdministration(id: string, options?: RequestOptions): Promise<AdministrationState> {
  return apiFetch(`/api/locations/${id}/administration`, {
    schema: z.object({ administration: administrationStateSchema }),
    ...options,
  }).then((r) => r.administration)
}

export function matchGoogleLocation(id: string, location: Record<string, unknown>): Promise<{ matches: unknown }> {
  return apiFetch(`/api/locations/${id}/administration`, {
    method: "POST",
    body: { operation: "match_location", location },
    schema: z.object({ matches: z.unknown() }),
  })
}

const mutationResultSchema = z.object({ id: z.string(), status: z.string(), idempotent: z.boolean() })

export function runAdministrationOperation(
  id: string,
  input: { operation: AdministrationOperation; payload?: Record<string, unknown> }
) {
  return apiFetch(`/api/locations/${id}/administration`, {
    method: "PATCH",
    body: { operation: input.operation, confirmation: ADMINISTRATION_CONFIRMATIONS[input.operation], payload: input.payload ?? {} },
    schema: mutationResultSchema,
  })
}
