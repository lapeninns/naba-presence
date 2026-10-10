import { z } from "zod"
import { gbpChangeSetSchema } from "./gbp-change-set"

export const googleAdminRoleSchema = z.enum(["PRIMARY_OWNER", "OWNER", "MANAGER", "SITE_MANAGER"])
export const googleAdminNameSchema = z.string().regex(/^(accounts|locations)\/[A-Za-z0-9_-]+\/admins\/[A-Za-z0-9_-]+$/)
export const googleAccountNameSchema = z.string().regex(/^accounts\/[A-Za-z0-9_-]+$/)
export const googleInvitationNameSchema = z.string().regex(/^accounts\/[A-Za-z0-9_-]+\/invitations\/[A-Za-z0-9_-]+$/)

const invitePayload = z.strictObject({
  scope: z.enum(["account", "location"]), role: googleAdminRoleSchema,
  admin: z.email().optional(), account: googleAccountNameSchema.optional(),
}).superRefine((value, context) => {
  if (Boolean(value.admin) === Boolean(value.account)) context.addIssue({ code: "custom", path: ["admin"], message: "Select exactly one invitee: an email address or a location-group account." })
  if (value.scope === "account" && value.account) context.addIssue({ code: "custom", path: ["account"], message: "Location-group account invitations are supported for location administrators." })
  if (value.scope === "account" && value.role === "SITE_MANAGER") context.addIssue({ code: "custom", path: ["role"], message: "Google does not allow creating an account administrator with the Site Manager role." })
})

export const administrationAccessRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("create_admin"), payload: invitePayload }),
  z.strictObject({ operation: z.literal("update_admin"), payload: z.strictObject({ name: googleAdminNameSchema, role: googleAdminRoleSchema }) }),
  z.strictObject({ operation: z.literal("delete_admin"), payload: z.strictObject({ name: googleAdminNameSchema }) }),
  z.strictObject({ operation: z.literal("accept_invitation"), payload: z.strictObject({ name: googleInvitationNameSchema }) }),
  z.strictObject({ operation: z.literal("decline_invitation"), payload: z.strictObject({ name: googleInvitationNameSchema }) }),
])
export type AdministrationAccessRequest = z.infer<typeof administrationAccessRequestSchema>

export const administrationAccessReviewSchema = z.object({
  changeSet: gbpChangeSetSchema,
  request: administrationAccessRequestSchema,
  target: z.string(), parent: z.string(),
  observedAt: z.iso.datetime(),
})
export type AdministrationAccessReview = z.infer<typeof administrationAccessReviewSchema>
export const administrationAccessReviewResponseSchema = z.object({ review: administrationAccessReviewSchema })
export const administrationAccessApprovalSchema = z.strictObject({ expectedPayloadHash: z.string().regex(/^[a-f0-9]{64}$/) })

export const reviewedAdministrationPayloadSchema = z.strictObject({
  request: administrationAccessRequestSchema,
  connectionId: z.uuid(), credentialGeneration: z.number().int().nonnegative(),
  observedAt: z.iso.datetime(),
})
