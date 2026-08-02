import { z } from "zod"

// A general UUID-shaped check (not zod's strict RFC 4122 z.uuid()) — the
// server's own z.uuid() is stricter, but the client only needs to catch
// obviously-malformed input before it reaches the server, which re-validates.
const UUID_SHAPE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export const legalHoldFormSchema = z.object({
  reviewId: z.string().trim().regex(UUID_SHAPE, "Enter the review identifier."),
  reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(1000),
})

export type LegalHoldFormValues = z.infer<typeof legalHoldFormSchema>
