import { z } from "zod"

const identifier = z.string().min(1).refine((value) => value.trim().length > 0, "An identifier is required.")
const units = z.string().regex(/^-?(0|[1-9]\d*)$/).max(20).refine((value) => {
  if (!/^-?(0|[1-9]\d*)$/.test(value) || value.length > 20) return false
  const integer = BigInt(value)
  return integer >= BigInt("-9223372036854775808") && integer <= BigInt("9223372036854775807")
}, "Price units must be a signed 64-bit integer string.")

export const googleServicePriceSchema = z.object({
  currencyCode: z.string().regex(/^[A-Z]{3}$/).optional(),
  units: units.optional(),
  nanos: z.number().int().min(-999999999).max(999999999).optional(),
}).strict().refine((price) => {
  if (!price.units || price.units.length > 20 || !/^-?\d+$/.test(price.units)) return true
  const whole = BigInt(price.units)
  const nanos = price.nanos ?? 0
  return whole === BigInt(0) || (whole > BigInt(0) ? nanos >= 0 : nanos <= 0)
}, "Price units and nanos must have consistent signs.")

export const googleServiceItemSchema = z.union([
  z.object({
    structuredServiceItem: z.object({
      serviceTypeId: identifier,
      description: z.string().max(300).optional(),
    }).strict(),
    price: googleServicePriceSchema.optional(),
  }).strict(),
  z.object({
    freeFormServiceItem: z.object({
      category: identifier,
      label: z.object({
        displayName: identifier,
        description: z.string().optional(),
        languageCode: z.string().min(2).max(35).optional(),
      }).strict(),
    }).strict(),
    price: googleServicePriceSchema.optional(),
  }).strict(),
])

export const googleServiceItemsSchema = z.array(googleServiceItemSchema).max(100)
export type GoogleServiceItem = z.infer<typeof googleServiceItemSchema>

export function serviceItemsMatch(actual: unknown, expected: readonly GoogleServiceItem[]): boolean {
  const parsed = googleServiceItemsSchema.safeParse(actual === undefined ? [] : actual)
  if (!parsed.success || parsed.data.length !== expected.length) return false
  const observed = parsed.data.map((item) => JSON.stringify(item)).sort()
  const requested = expected.map((item) => JSON.stringify(googleServiceItemSchema.parse(item))).sort()
  return requested.every((item, index) => item === observed[index])
}

export const googleServiceCategorySchema = z.object({
  name: identifier,
  displayName: z.string().optional(),
  serviceTypes: z.array(z.object({ serviceTypeId: identifier, displayName: z.string().optional() })).default([]),
  moreHoursTypes: z.array(z.object({ hoursTypeId: identifier, displayName: z.string().optional(), localizedDisplayName: z.string().optional() })).optional(),
})
export const googleServiceCategoriesSchema = z.object({ categories: z.array(googleServiceCategorySchema).default([]) })
export type GoogleServiceCategory = z.infer<typeof googleServiceCategorySchema>

export function serviceCategoryId(name: string) {
  return name.replace(/^categories\//, "")
}

export function unsupportedServiceIndexes(items: readonly GoogleServiceItem[], existing: readonly GoogleServiceItem[], categories: readonly GoogleServiceCategory[]) {
  const unchanged = new Set(existing.map((item) => JSON.stringify(googleServiceItemSchema.parse(item))))
  const categoryIds = new Set(categories.map((category) => serviceCategoryId(category.name)))
  const types = new Set(categories.flatMap((category) => category.serviceTypes.map((service) => service.serviceTypeId)))
  return items.flatMap((item, index) => {
    if (unchanged.has(JSON.stringify(googleServiceItemSchema.parse(item)))) return []
    const supported = "structuredServiceItem" in item
      ? types.has(item.structuredServiceItem.serviceTypeId)
      : categoryIds.has(serviceCategoryId(item.freeFormServiceItem.category))
    return supported ? [] : [index]
  })
}
