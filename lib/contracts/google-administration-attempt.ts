import { z } from "zod"
import { gbpConfirmationStateSchema, gbpExecutionStateSchema } from "./gbp-management"
import { administrationAccessRequestSchema } from "./google-administration-review"

export const administrationAccessObservationSchema = z.object({
  observedAt: z.iso.datetime(),
  baseline: z.object({ collection: z.string(), rows: z.array(z.record(z.string(), z.unknown())) }),
  acceptedAccount: z.object({ name: z.string(), role: z.string().nullable() }).nullable(),
})
export type AdministrationAccessObservation = z.infer<typeof administrationAccessObservationSchema>

export const administrationAccessAttemptSchema = z.object({
  id: z.uuid(), reviewId: z.uuid(), payloadHash: z.string(),
  request: administrationAccessRequestSchema,
  target: z.string(), status: z.enum(["started", "validated", "succeeded", "failed", "ambiguous"]),
  executionState: gbpExecutionStateSchema, confirmationState: gbpConfirmationStateSchema,
  idempotent: z.boolean(), observation: administrationAccessObservationSchema.nullable(),
  postcondition: z.enum(["administrator_present", "administrator_role_changed", "administrator_absent", "invitation_absent", "account_access_present", "unknown"]),
  pendingInvitation: z.boolean().nullable(),
  error: z.enum(["provider_rejected", "refresh_unavailable", "outcome_unresolved"]).nullable(),
})
export type AdministrationAccessAttempt = z.infer<typeof administrationAccessAttemptSchema>
export const administrationAccessAttemptResponseSchema = z.object({ attempt: administrationAccessAttemptSchema })
