import { z } from "zod"
import { googleAccountNameSchema, googleAdminRoleSchema } from "./google-administration-review"

export const lifecycleLocationNameSchema = z.string().regex(/^locations\/[A-Za-z0-9_-]+$/)
export const googleLifecycleRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("transfer_location"), payload: z.strictObject({ destinationAccount: googleAccountNameSchema }) }),
  z.strictObject({ operation: z.literal("delete_location"), payload: z.strictObject({}) }),
])
export type GoogleLifecycleRequest = z.infer<typeof googleLifecycleRequestSchema>

export const lifecycleAccountSchema = z.strictObject({ name: googleAccountNameSchema, role: googleAdminRoleSchema.nullable() })
export const lifecycleLocationSchema = z.strictObject({
  name: lifecycleLocationNameSchema, placeId: z.string().min(1).nullable(), canDelete: z.boolean().nullable(),
})
export const lifecycleInventorySchema = z.strictObject({
  account: lifecycleAccountSchema, complete: z.boolean(), locations: z.array(lifecycleLocationSchema),
})
export const googleLifecycleBaselineSchema = z.strictObject({
  observedAt: z.iso.datetime(), location: lifecycleLocationSchema,
  source: lifecycleInventorySchema, destination: lifecycleInventorySchema.nullable(),
})
export type GoogleLifecycleBaseline = z.infer<typeof googleLifecycleBaselineSchema>

export const googleLifecycleObservationSchema = z.strictObject({
  observedAt: z.iso.datetime(), source: lifecycleInventorySchema,
  destination: lifecycleInventorySchema.nullable(),
  locationRead: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("accessible"), location: lifecycleLocationSchema }),
    z.strictObject({ state: z.enum(["not_found", "forbidden", "unavailable"]) }),
  ]),
})
export type GoogleLifecycleObservation = z.infer<typeof googleLifecycleObservationSchema>
