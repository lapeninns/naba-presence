// Contract for /api/locations/[id]/business-information. Client-safe: zod
// and lib/domain/business-information only.
import { z } from "zod"
import { googleCapabilityDetailsSchema } from "@/lib/domain/google-capabilities"
import { googleServiceCategorySchema } from "@/lib/domain/google-services"
import { googleAttributeNameSchema, googleAttributeWriteSchema } from "@/lib/domain/google-attributes"

import {
  BUSINESS_INFORMATION_UPDATE_MASKS,
  businessInformationPayloadSchema,
  googleAttributeSchema,
} from "@/lib/domain/business-information"

import { gbpMutationResultSchema } from "./gbp-management"

export { BUSINESS_INFORMATION_UPDATE_MASKS, businessInformationPayloadSchema, googleAttributeSchema }
export const businessInformationConfirmationSchema = z.object({ mutationId: z.uuid() }).strict()

export type BusinessMask = (typeof BUSINESS_INFORMATION_UPDATE_MASKS)[number]
export type BusinessInformationPayload = z.infer<typeof businessInformationPayloadSchema>
export type GoogleAttribute = z.infer<typeof googleAttributeSchema>

// --- GET ------------------------------------------------------------------

// The Google location + attributes are freeform (they vary by category and by
// what the merchant has set), so keep them as passthrough records — the editor
// reads known leaves and preserves the rest. Only the envelope is pinned.
export const attributeMetadataSchema = z.looseObject({
  parent: z.string(),
  displayName: z.string().optional(),
  groupDisplayName: z.string().optional(),
  valueType: z.string().optional(),
  deprecated: z.boolean().optional(),
  repeatable: z.boolean().optional(),
})
export type AttributeMetadata = z.infer<typeof attributeMetadataSchema>

export const businessInformationStateSchema = z.object({
  location: z.record(z.string(), z.unknown()),
  attributes: z.record(z.string(), z.unknown()),
  attributeMetadata: z.array(attributeMetadataSchema),
  locationHash: z.string().length(64),
  attributesHash: z.string().length(64),
  canPublish: z.boolean(),
  writesEnabled: z.boolean(),
  capabilityDetails: googleCapabilityDetailsSchema.optional(),
})
export type BusinessInformationState = z.infer<typeof businessInformationStateSchema>

export const businessInformationResponseSchema = z.object({
  businessInformation: businessInformationStateSchema,
})
export type BusinessInformationResponse = z.infer<typeof businessInformationResponseSchema>

export const serviceMetadataResponseSchema = z.object({
  serviceMetadata: z.object({
    categories: z.array(googleServiceCategorySchema),
    regionCode: z.string(), languageCode: z.string(),
    observedAt: z.string(), locationHash: z.string().length(64),
  }),
})

/** `?type=categories|chains&query=…` turns the GET into a metadata search. */
export const BUSINESS_INFORMATION_METADATA_TYPES = ["categories", "chains"] as const
export const businessInformationMetadataTypeSchema = z.enum(BUSINESS_INFORMATION_METADATA_TYPES)
export type BusinessInformationMetadataType = z.infer<typeof businessInformationMetadataTypeSchema>

export type BusinessInformationMetadataQuery = {
  type: BusinessInformationMetadataType
  query: string
  regionCode?: string
  languageCode?: string
}

export const businessInformationMetadataResponseSchema = z.object({ result: z.unknown() })
export type BusinessInformationMetadataResponse = z.infer<typeof businessInformationMetadataResponseSchema>

// --- PATCH ----------------------------------------------------------------

export const businessInformationLocationUpdateSchema = z.object({
  operation: z.literal("update_location"),
  confirmation: z.literal("publish_business_information_to_google"),
  expectedGoogleHash: z.string().length(64),
  updateMask: z.array(z.enum(BUSINESS_INFORMATION_UPDATE_MASKS)).min(1),
  payload: businessInformationPayloadSchema,
  changeSetId: z.uuid().optional(),
})

export const businessInformationPreviewSchema = businessInformationLocationUpdateSchema.pick({
  expectedGoogleHash: true, updateMask: true, payload: true,
})

export const businessInformationApprovalSchema = z.object({
  changeSetId: z.uuid(), expectedPayloadHash: z.string().length(64),
  resourceType: z.enum(["business_info", "attributes"]).default("business_info"),
})
export type BusinessInformationLocationUpdate = z.infer<typeof businessInformationLocationUpdateSchema>

export const businessInformationAttributeUpdateSchema = z.object({
  operation: z.literal("update_attributes"),
  confirmation: z.literal("publish_business_attributes_to_google"),
  expectedGoogleHash: z.string().length(64),
  attributeMask: z.array(googleAttributeNameSchema).min(1).refine((names) => new Set(names).size === names.length, "Attribute mask entries must be unique."),
  attributes: z.array(googleAttributeWriteSchema),
  changeSetId: z.uuid().optional(),
}).superRefine((value, context) => {
  const names = new Set<string>()
  value.attributes.forEach((attribute, index) => {
    if (names.has(attribute.name)) context.addIssue({ code: "custom", path: ["attributes", index, "name"], message: "Each attribute can appear only once." })
    if (!value.attributeMask.includes(attribute.name)) context.addIssue({ code: "custom", path: ["attributes", index, "name"], message: "Every supplied attribute must be included in the reviewed mask." })
    names.add(attribute.name)
  })
})
export type BusinessInformationAttributeUpdate = z.infer<typeof businessInformationAttributeUpdateSchema>
export const businessAttributesPreviewSchema = z.preprocess(
  (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? { ...value, confirmation: "publish_business_attributes_to_google" } : value,
  businessInformationAttributeUpdateSchema,
)

export const businessInformationPatchSchema = z.discriminatedUnion("operation", [
  businessInformationLocationUpdateSchema,
  businessInformationAttributeUpdateSchema,
])
export type BusinessInformationPatchBody = z.infer<typeof businessInformationPatchSchema>

export const businessInformationMutationResultSchema = gbpMutationResultSchema
export type BusinessInformationMutationResult = z.infer<typeof businessInformationMutationResultSchema>
