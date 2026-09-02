// Contract for /api/locations/[id]/administration. Client-safe: zod only.
import { z } from "zod"

import { gbpMutationWithResponseResultSchema, sectionResultSchema } from "./gbp-management"

export { sectionResultSchema, type SectionResult } from "./gbp-management"

// --- GET ------------------------------------------------------------------

export const administrationStateSchema = z.object({
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

export const administrationResponseSchema = z.object({
  administration: administrationStateSchema,
})
export type AdministrationResponse = z.infer<typeof administrationResponseSchema>

// Google admin / invitation rows as the account-management API returns them.
// They arrive inside the freeform `locationAdmins` / `accountAdmins` /
// `invitations` sections; these describe the leaves the console reads.
export const googleAdminRowSchema = z.looseObject({
  name: z.string(),
  admin: z.string().optional(),
  account: z.string().optional(),
  role: z.string().optional(),
  pendingInvitation: z.boolean().optional(),
})
export type GoogleAdminRow = z.infer<typeof googleAdminRowSchema>

export const googleInvitationRowSchema = z.looseObject({
  name: z.string(),
  role: z.string().optional(),
  targetType: z.string().optional(),
  targetAccount: z.record(z.string(), z.unknown()).optional(),
  targetLocation: z.record(z.string(), z.unknown()).optional(),
})
export type GoogleInvitationRow = z.infer<typeof googleInvitationRowSchema>

// --- POST (match) -----------------------------------------------------------

export const administrationMatchSchema = z.object({
  operation: z.literal("match_location"),
  location: z.record(z.string(), z.unknown()),
})
export type AdministrationMatchBody = z.infer<typeof administrationMatchSchema>

export const administrationMatchResponseSchema = z.object({ matches: z.unknown() })
export type AdministrationMatchResponse = z.infer<typeof administrationMatchResponseSchema>

// --- PATCH ----------------------------------------------------------------

export const ADMINISTRATION_OPERATIONS = [
  "start_verification",
  "complete_verification",
  "create_admin",
  "update_admin",
  "delete_admin",
  "accept_invitation",
  "decline_invitation",
  "transfer_location",
  "create_location",
  "delete_location",
  "accept_google_update",
] as const
export const administrationOperationSchema = z.enum(ADMINISTRATION_OPERATIONS)
export type AdministrationOperation = z.infer<typeof administrationOperationSchema>

/** Each operation must be sent with exactly this confirmation literal. */
export const ADMINISTRATION_CONFIRMATIONS = {
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
} as const satisfies Record<AdministrationOperation, string>

export const DANGER_ZONE_OPERATIONS: ReadonlySet<AdministrationOperation> = new Set<AdministrationOperation>([
  "delete_admin",
  "transfer_location",
  "delete_location",
])

export const administrationMutationSchema = z
  .object({
    operation: administrationOperationSchema,
    confirmation: z.string().min(1),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((value, ctx) => {
    const expected = ADMINISTRATION_CONFIRMATIONS[value.operation]
    if (value.confirmation !== expected) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmation"],
        message: `Confirmation must be “${expected}”.`,
      })
    }
  })
export type AdministrationMutation = z.infer<typeof administrationMutationSchema>

export const administrationMutationResultSchema = gbpMutationWithResponseResultSchema
export type AdministrationMutationResult = z.infer<typeof administrationMutationResultSchema>
