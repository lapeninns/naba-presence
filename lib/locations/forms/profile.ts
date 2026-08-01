import { z } from "zod"

// Mirrors saveSchema.values in app/api/locations/[id]/profile/route.ts — keep in sync.
// Modelled as form strings ("" is submitted as null); website allows "" or a URL.
export const profileFormSchema = z.object({
  name: z.string().trim().max(255),
  description: z.string().trim().max(750),
  phone: z.string().trim().max(50),
  website: z.union([z.literal(""), z.url().max(2048)]),
})
export type ProfileFormValues = z.infer<typeof profileFormSchema>

// Convert the four editable form fields to the PUT `values` payload ("" -> null).
export function toProfileValues(values: ProfileFormValues) {
  const nn = (v: string) => (v.trim() ? v.trim() : null)
  return { name: nn(values.name), description: nn(values.description), phone: nn(values.phone), website: nn(values.website) }
}
