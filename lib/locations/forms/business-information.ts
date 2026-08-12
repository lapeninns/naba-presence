import { z } from "zod"

/**
 * Normalized editable Business Information fields (Slice 0 form DTO).
 * Used for client-side section validation before Google publish.
 */
export const businessInformationFormSchema = z.object({
  title: z.string().trim().min(1, "Enter a business name.").max(100),
  primaryPhone: z.string().trim().max(30).optional().or(z.literal("")),
  websiteUri: z
    .string()
    .trim()
    .url("Enter a valid website address.")
    .optional()
    .or(z.literal("")),
  storeCode: z.string().trim().max(64).optional().or(z.literal("")),
  labels: z.array(z.string().trim().max(50)).max(20).optional(),
  openInfoStatus: z
    .enum([
      "OPEN",
      "CLOSED_PERMANENTLY",
      "CLOSED_TEMPORARILY",
      "OPEN_FOR_BUSINESS_UNSPECIFIED",
    ])
    .optional(),
})

export type BusinessInformationForm = z.infer<
  typeof businessInformationFormSchema
>

export function validateBusinessInformationDraft(input: {
  title: string
  primaryPhone?: string
  websiteUri?: string
  storeCode?: string
}): { ok: true; values: BusinessInformationForm } | { ok: false; fieldErrors: Record<string, string> } {
  const parsed = businessInformationFormSchema.safeParse(input)
  if (parsed.success) return { ok: true, values: parsed.data }
  const fieldErrors: Record<string, string> = {}
  for (const issue of parsed.error.issues) {
    const path = issue.path.join(".") || "_root"
    if (!fieldErrors[path]) fieldErrors[path] = issue.message
  }
  return { ok: false, fieldErrors }
}
