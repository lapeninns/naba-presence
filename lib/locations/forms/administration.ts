import { z } from "zod"

export const createAdminSchema = z.object({
  scope: z.enum(["account", "location"]),
  admin: z.string().trim().email("Enter a valid email address."),
  role: z.enum(["OWNER", "MANAGER"]),
})
export type CreateAdminValues = z.infer<typeof createAdminSchema>

export const updateAdminSchema = z.object({
  name: z.string().min(1),
  role: z.enum(["OWNER", "MANAGER"]),
})
export const transferLocationSchema = z.object({
  destinationAccount: z
    .string()
    .trim()
    .min(1, "Enter the destination Google account."),
})

/** Server route mutation envelope (Slice 0). */
export const administrationOperationSchema = z.enum([
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
])
export type AdministrationOperation = z.infer<
  typeof administrationOperationSchema
>

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

export type AdministrationMutation = z.infer<
  typeof administrationMutationSchema
>
