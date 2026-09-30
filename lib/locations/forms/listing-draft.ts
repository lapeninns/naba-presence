import { z } from "zod"
import type { BusinessInformationDraft } from "../google-values"
import { googleServiceAreaSchema } from "@/lib/domain/google-service-area"
import { googleRelationshipSchema } from "@/lib/domain/google-relationships"

const category = z.object({ name: z.string(), displayName: z.string().nullable().optional() })
const listingDraftSchema = z.object({
  title: z.string(), description: z.string(), primaryPhone: z.string(), websiteUri: z.string(),
  additionalPhones: z.array(z.string()).max(2).optional(),
  adPhone: z.string().optional(),
  openStatus: z.string(), storeCode: z.string(), labels: z.array(z.string()),
  primaryCategory: category.nullable(), additionalCategories: z.array(category),
  addressLines: z.array(z.string()), locality: z.string(), postalCode: z.string(), regionCode: z.string(),
  administrativeArea: z.string().optional(), sublocality: z.string().optional(),
  addressLanguageCode: z.string().optional(), addressOrganization: z.string().optional(), addressSortingCode: z.string().optional(), addressRecipients: z.array(z.string()).optional(),
  openingDate: z.object({ year: z.string(), month: z.string(), day: z.string() }).strict().nullable().optional(),
  serviceArea: googleServiceAreaSchema.optional(),
  relationshipData: googleRelationshipSchema.optional(),
  clearStorefrontAddress: z.boolean().optional(),
})

export function parseListingDraft(value: unknown): BusinessInformationDraft | null {
  const result = listingDraftSchema.safeParse(value)
  return result.success ? result.data : null
}
