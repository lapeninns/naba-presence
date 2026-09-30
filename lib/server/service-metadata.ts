import "server-only"
import { z } from "zod"
import { googleServiceCategoriesSchema, serviceCategoryId } from "@/lib/domain/google-services"
import { batchGetGoogleCategories } from "./google/locations"
import { ApiError } from "./http"

const category = z.object({ name: z.string().min(1) })
const locationContext = z.object({
  languageCode: z.string().min(2).max(35).optional(),
  categories: z.object({ primaryCategory: category, additionalCategories: z.array(category).max(9).optional() }),
  storefrontAddress: z.object({ regionCode: z.string().length(2).optional() }).optional(),
  serviceArea: z.object({ regionCode: z.string().length(2).optional() }).optional(),
})

export async function loadGoogleServiceMetadata(token: string, location: unknown, connectionKey: string) {
  const parsed = locationContext.safeParse(location)
  if (!parsed.success) throw new ApiError(409, "service_categories_unknown", "Refresh the location's categories before editing services.")
  const { categories, storefrontAddress, serviceArea } = parsed.data
  const names = [...new Set([categories.primaryCategory, ...(categories.additionalCategories ?? [])].map((item) => serviceCategoryId(item.name)))]
  const regionCode = storefrontAddress?.regionCode ?? serviceArea?.regionCode ?? "GB"
  const languageCode = parsed.data.languageCode ?? "en"
  const response = googleServiceCategoriesSchema.safeParse(await batchGetGoogleCategories(token, { names, regionCode, languageCode }, { connectionKey }))
  if (!response.success) throw new ApiError(502, "service_metadata_invalid", "Google returned service metadata that could not be read.")
  const selected = response.data.categories.filter((item) => names.includes(serviceCategoryId(item.name)))
  if (!names.every((name) => selected.some((item) => serviceCategoryId(item.name) === name))) {
    throw new ApiError(409, "service_metadata_incomplete", "Google did not return all current categories. Refresh before editing services.")
  }
  return { categories: selected, regionCode, languageCode, observedAt: new Date().toISOString() }
}
