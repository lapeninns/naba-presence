import { z } from "zod"
import { googleServiceAreaSchema } from "./google-service-area"
import { googleServiceItemsSchema } from "./google-services"
import { googleRelationshipSchema } from "./google-relationships"
import { googleAdvertisingSchema } from "./google-advertising"

const nonEmpty = z.string().trim().min(1)
const categorySchema = z.object({ name: nonEmpty })
const addressLanguageSchema = z.string().trim().max(35).refine((value) => {
  if (!value) return true
  try { return Intl.getCanonicalLocales(value).length === 1 } catch { return false }
}, "Enter a valid address language tag, such as en or cy, or leave it blank.")

function daysInMonth(year: number, month: number) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

export const googleOpeningDateSchema = z.object({
  year: z.number().int().min(1).max(9999),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(0).max(31).optional(),
}).strict().superRefine((date, context) => {
  if (date.day && date.day > daysInMonth(date.year, date.month)) {
    context.addIssue({ code: "custom", path: ["day"], message: "Enter a valid day for this month and year." })
  }
  const today = new Date()
  const limitYear = today.getUTCFullYear() + 1
  const limitMonth = today.getUTCMonth() + 1
  const limitDay = Math.min(today.getUTCDate(), daysInMonth(limitYear, limitMonth))
  const laterMonth = date.year > limitYear || (date.year === limitYear && date.month > limitMonth)
  const laterDay = date.year === limitYear && date.month === limitMonth && (date.day ?? 0) > limitDay
  if (laterMonth || laterDay) {
    context.addIssue({ code: "custom", message: "Opening dates cannot be more than one year in the future." })
  }
})

export const BUSINESS_INFORMATION_UPDATE_MASKS = [
  "title",
  "profile",
  "phoneNumbers",
  "adWordsLocationExtensions",
  "websiteUri",
  "storefrontAddress",
  "storefrontAddress.addressLines",
  "storefrontAddress.locality",
  "storefrontAddress.postalCode",
  "storefrontAddress.regionCode",
  "storefrontAddress.administrativeArea",
  "storefrontAddress.sublocality",
  "storefrontAddress.languageCode",
  "storefrontAddress.organization",
  "storefrontAddress.recipients",
  "storefrontAddress.sortingCode",
  "categories",
  "serviceArea",
  "serviceItems",
  "labels",
  "storeCode",
  "openInfo",
  "openInfo.status",
  "openInfo.openingDate",
  "relationshipData",
  "relationshipData.parentChain",
  "relationshipData.parentLocation",
  "relationshipData.childrenLocations",
] as const

export function openingDatesMatch(observed: unknown, expected: z.infer<typeof googleOpeningDateSchema> | undefined) {
  if (observed == null) return expected === undefined
  if (typeof observed !== "object" || Array.isArray(observed)) return false
  const year = "year" in observed ? observed.year : 0
  const month = "month" in observed ? observed.month : 0
  const day = "day" in observed ? observed.day : 0
  if (!expected) return year === 0 && month === 0 && day === 0
  return year === expected.year && month === expected.month && day === (expected.day ?? 0)
}

export function additionalPhonesMatch(observed: unknown, expected: readonly string[]) {
  const phones = z.array(z.string()).safeParse(observed ?? [])
  if (!phones.success || phones.data.length !== expected.length) return false
  const left = [...phones.data].sort()
  return [...expected].sort().every((phone, index) => phone === left[index])
}

export const businessInformationPayloadSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    profile: z
      .object({ description: z.string().trim().max(750).optional() })
      .optional(),
    phoneNumbers: z
      .object({
        primaryPhone: z.string().trim().max(50).optional(),
        additionalPhones: z.array(z.string().trim().min(1).max(50)).max(2).optional(),
      })
      .optional(),
    websiteUri: z.url().max(2048).or(z.literal("")).optional(),
    storefrontAddress: z.union([z.object({
        regionCode: z.string().trim().length(2),
        languageCode: addressLanguageSchema.optional(),
        organization: z.string().trim().max(200).optional(),
        recipients: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
        sortingCode: z.string().trim().max(100).optional(),
        revision: z.literal(0).optional(),
        postalCode: z.string().trim().max(30).optional(),
        administrativeArea: z.string().trim().max(100).optional(),
        locality: z.string().trim().max(100).optional(),
        sublocality: z.string().trim().max(100).optional(),
        addressLines: z.array(z.string().trim().min(1).max(200)).max(5),
      }), z.object({}).strict()]).optional(),
    categories: z
      .object({
        primaryCategory: categorySchema,
        additionalCategories: z.array(categorySchema).max(9).optional(),
      })
      .optional(),
    serviceArea: googleServiceAreaSchema.optional(),
    serviceItems: googleServiceItemsSchema.optional(),
    labels: z.array(z.string().trim().min(1).max(255)).max(10).optional(),
    storeCode: z.string().trim().max(255).optional(),
    openInfo: z
      .object({
        status: z.enum(["OPEN", "CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"]),
        openingDate: googleOpeningDateSchema.optional(),
      })
      .optional(),
    relationshipData: googleRelationshipSchema.optional(),
    adWordsLocationExtensions: googleAdvertisingSchema.optional(),
  })
  .strict()

export const googleAttributeSchema = z
  .object({
    name: nonEmpty,
    values: z.array(z.unknown()).optional(),
    uriValues: z
      .array(z.object({ uri: z.url(), uriType: z.string().optional() }))
      .optional(),
    repeatedEnumValue: z
      .object({
        setValues: z.array(z.string()).optional(),
        unsetValues: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .strict()

export function assertBusinessInformationMask(
  payload: Record<string, unknown>,
  updateMask: readonly string[]
) {
  for (const field of updateMask) {
    if (field.startsWith("relationshipData.")) {
      z.record(z.string(), z.unknown()).refine((relationship) => Object.hasOwn(relationship, field.slice("relationshipData.".length)), "The selected relationship field is missing from the approved payload.").parse(payload.relationshipData)
      continue
    }
    if (field.startsWith("storefrontAddress.")) {
      z.record(z.string(), z.unknown()).refine((address) => Object.hasOwn(address, field.slice("storefrontAddress.".length)), "The selected address field is missing from the approved payload.").parse(payload.storefrontAddress)
      continue
    }
    if (field === "openInfo.openingDate" && payload.openInfo && typeof payload.openInfo === "object") continue
    if (field === "openInfo.status") {
      const openInfo = payload.openInfo
      if (openInfo && typeof openInfo === "object" && "status" in openInfo) continue
      throw new Error("The open status is missing from the approved payload.")
    }
    if (!Object.prototype.hasOwnProperty.call(payload, field)) {
      throw new Error(`The ${field} field is missing from the approved payload.`)
    }
  }
}

export function assertCompletePhoneNumbers(payload: Record<string, unknown>, updateMask: readonly string[]) {
  if (!updateMask.includes("phoneNumbers")) return
  z.object({
    primaryPhone: z.string().trim().min(1).max(50),
    additionalPhones: z.array(z.string().trim().min(1).max(50)).max(2),
  }).parse(payload.phoneNumbers)
}

export function addressFieldMatches(observed: unknown, expected: unknown, field: string): boolean {
  const current = z.record(z.string(), z.unknown()).safeParse(observed ?? {})
  const desired = z.record(z.string(), z.unknown()).safeParse(expected)
  if (!current.success || !desired.success || !Object.hasOwn(desired.data, field)) return false
  const value = desired.data[field]
  const actual = current.data[field]
  if (field === "addressLines" || field === "recipients") {
    const wanted = z.array(z.string()).safeParse(value)
    const found = z.array(z.string()).safeParse(actual ?? [])
    return wanted.success && found.success && wanted.data.length === found.data.length && wanted.data.every((line, index) => line === found.data[index])
  }
  return typeof value === "string" && (actual === value || (value === "" && actual === undefined))
}

export function unsupportedAddressDetails(observed: unknown, masks: readonly string[]): boolean {
  const fields = ["languageCode", "organization", "recipients", "sortingCode"].filter((field) => masks.includes(`storefrontAddress.${field}`))
  if (!fields.length || observed === undefined) return false
  const address = z.record(z.string(), z.unknown()).safeParse(observed)
  if (!address.success) return true
  return fields.some((field) => {
    const value = address.data[field]
    return value !== undefined && !(field === "recipients" ? z.array(z.string()).safeParse(value).success : typeof value === "string")
  })
}
