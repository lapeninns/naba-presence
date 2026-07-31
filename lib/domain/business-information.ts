import { z } from "zod"

const nonEmpty = z.string().trim().min(1)
const categorySchema = z.object({ name: nonEmpty })

export const BUSINESS_INFORMATION_UPDATE_MASKS = [
  "title",
  "profile",
  "phoneNumbers",
  "websiteUri",
  "storefrontAddress",
  "categories",
  "serviceArea",
  "serviceItems",
  "labels",
  "storeCode",
  "openInfo",
  "relationshipData",
] as const

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
    storefrontAddress: z
      .object({
        regionCode: z.string().trim().length(2),
        languageCode: z.string().trim().min(2).max(35).optional(),
        postalCode: z.string().trim().max(30).optional(),
        administrativeArea: z.string().trim().max(100).optional(),
        locality: z.string().trim().max(100).optional(),
        sublocality: z.string().trim().max(100).optional(),
        addressLines: z.array(z.string().trim().min(1).max(200)).max(5),
      })
      .optional(),
    categories: z
      .object({
        primaryCategory: categorySchema,
        additionalCategories: z.array(categorySchema).max(9).optional(),
      })
      .optional(),
    serviceArea: z
      .object({
        businessType: z.enum([
          "CUSTOMER_LOCATION_ONLY",
          "CUSTOMER_AND_BUSINESS_LOCATION",
        ]),
        regionCode: z.string().trim().length(2).optional(),
        places: z
          .object({
            placeInfos: z
              .array(
                z.object({
                  placeName: nonEmpty,
                  placeId: nonEmpty,
                })
              )
              .max(20),
          })
          .optional(),
      })
      .optional(),
    serviceItems: z
      .array(z.record(z.string(), z.unknown()))
      .max(100)
      .optional(),
    labels: z.array(z.string().trim().min(1).max(255)).max(10).optional(),
    storeCode: z.string().trim().max(255).optional(),
    openInfo: z
      .object({
        status: z.enum(["OPEN", "CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"]),
        openingDate: z
          .object({
            year: z.number().int().min(1000).max(3000),
            month: z.number().int().min(1).max(12).optional(),
            day: z.number().int().min(1).max(31).optional(),
          })
          .optional(),
      })
      .optional(),
    relationshipData: z
      .object({
        parentChain: z.string().trim().optional(),
        parentLocation: z
          .object({
            placeId: nonEmpty,
            relationType: z.enum([
              "DEPARTMENT_OF",
              "INDEPENDENT_ESTABLISHMENT_IN",
            ]),
          })
          .optional(),
        childrenLocations: z
          .array(
            z.object({
              placeId: nonEmpty,
              relationType: z.enum([
                "DEPARTMENT_OF",
                "INDEPENDENT_ESTABLISHMENT_IN",
              ]),
            })
          )
          .optional(),
      })
      .optional(),
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
    if (!Object.prototype.hasOwnProperty.call(payload, field)) {
      throw new Error(`The ${field} field is missing from the approved payload.`)
    }
  }
}
