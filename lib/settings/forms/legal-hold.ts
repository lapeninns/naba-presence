import { z } from "zod"

export const legalHoldFormSchema = z.object({
  reviewId: z.string().trim().pipe(z.uuid("Enter the review identifier.")),
  reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(1000),
})

export type LegalHoldFormValues = z.infer<typeof legalHoldFormSchema>
