import { z } from "zod"

import { GOOGLE_SUPPORT_CHECKED_AT, GOOGLE_SUPPORT_VERSION } from "./google-support"

const locationReference = "https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations"
const fieldReference = "https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations"

export const GOOGLE_CAPABILITY_REASONS = [
  "reconnect_required",
  "permission_denied",
  "publishing_paused",
  "verification_required",
  "location_ineligible",
  "provider_capability_retired",
  "eligibility_unknown",
  "managed_in_google",
  "provider_read_only",
  "immutable_after_creation",
] as const

export const googleCapabilityDetailSchema = z.object({
  support: z.enum(["supported", "read_only", "create_only", "external", "retired"]),
  eligibility: z.enum(["eligible", "ineligible", "unknown", "not_applicable"]),
  canWrite: z.boolean(),
  canValidate: z.boolean(),
  reasonCode: z.enum(GOOGLE_CAPABILITY_REASONS).optional(),
  providerMethod: z.string(),
  eligibilitySource: z.string(),
  documentation: z.url(),
  documentationCheckedAt: z.string(),
  observedAt: z.string().nullable(),
  handoffUrl: z.url().optional(),
})
export type GoogleCapabilityDetail = z.infer<typeof googleCapabilityDetailSchema>

export const googleCapabilityDetailsSchema = z.object({
  version: z.string(),
  fields: z.record(z.string(), googleCapabilityDetailSchema),
})
export type GoogleCapabilityDetails = z.infer<typeof googleCapabilityDetailsSchema>

type FieldDefinition = {
  readonly support: GoogleCapabilityDetail["support"]
  readonly providerMethod: string
  readonly eligibilitySource: string
  readonly documentation: string
  readonly metadataFlag?: string
  readonly handoffUrl?: string
}

const writable: FieldDefinition = {
  support: "supported",
  providerMethod: "locations.patch",
  eligibilitySource: "locations.patch(validateOnly=true)",
  documentation: locationReference,
}

export const GOOGLE_LOCATION_FIELDS = {
  name: { ...writable, support: "read_only", providerMethod: "locations.get" },
  languageCode: { ...writable, support: "create_only", providerMethod: "accounts.locations.create" },
  title: writable,
  storeCode: writable,
  phoneNumbers: writable,
  "phoneNumbers.primaryPhone": writable,
  "phoneNumbers.additionalPhones": writable,
  websiteUri: writable,
  profile: writable,
  "profile.description": writable,
  storefrontAddress: writable,
  "storefrontAddress.regionCode": writable,
  "storefrontAddress.languageCode": writable,
  "storefrontAddress.organization": writable,
  "storefrontAddress.recipients": writable,
  "storefrontAddress.sortingCode": { ...writable, eligibilitySource: "Country-specific postal usage; locations.patch(validateOnly=true)", documentation: `${fieldReference}#PostalAddress` },
  "storefrontAddress.revision": { ...writable, support: "read_only", providerMethod: "locations.get", eligibilitySource: "PostalAddress schema revision is fixed at 0", documentation: `${fieldReference}#PostalAddress` },
  "storefrontAddress.postalCode": writable,
  "storefrontAddress.administrativeArea": writable,
  "storefrontAddress.locality": writable,
  "storefrontAddress.sublocality": writable,
  "storefrontAddress.addressLines": writable,
  categories: { ...writable, eligibilitySource: "categories.list / categories.batchGet" },
  "categories.primaryCategory": { ...writable, eligibilitySource: "categories.list / categories.batchGet" },
  "categories.additionalCategories": { ...writable, eligibilitySource: "categories.list / categories.batchGet" },
  regularHours: writable,
  specialHours: writable,
  moreHours: { ...writable, eligibilitySource: "categories.moreHoursTypes" },
  serviceArea: writable,
  "serviceArea.businessType": writable,
  "serviceArea.places.placeInfos": writable,
  "serviceArea.regionCode": { ...writable, support: "create_only", providerMethod: "accounts.locations.create", documentation: `${fieldReference}#ServiceAreaBusiness` },
  labels: writable,
  adWordsLocationExtensions: writable,
  "adWordsLocationExtensions.adPhone": writable,
  latlng: { ...writable, support: "external", eligibilitySource: "Google-approved client required", handoffUrl: "https://business.google.com/" },
  openInfo: writable,
  "openInfo.status": writable,
  "openInfo.openingDate": writable,
  "openInfo.canReopen": { ...writable, support: "read_only", providerMethod: "locations.get" },
  metadata: { ...writable, support: "read_only", providerMethod: "locations.get" },
  relationshipData: writable,
  "relationshipData.parentChain": writable,
  "relationshipData.parentLocation": writable,
  "relationshipData.childrenLocations": writable,
  serviceItems: {
    ...writable,
    metadataFlag: "canModifyServiceList",
    eligibilitySource: "location.metadata.canModifyServiceList",
    documentation: "https://developers.google.com/my-business/content/services",
  },
} as const satisfies Readonly<Record<string, FieldDefinition>>

export function metadataEligibility(
  location: Readonly<Record<string, unknown>>,
  flag: string
): "eligible" | "ineligible" | "unknown" {
  const metadata = location.metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "unknown"
  const value: unknown = Reflect.get(metadata, flag)
  if (value === true) return "eligible"
  if (value === false) return "ineligible"
  return "unknown"
}

export function locationFieldCapabilities(input: {
  readonly location: Readonly<Record<string, unknown>>
  readonly canPublish: boolean
  readonly writesEnabled: boolean
  readonly observedAt: string | null
}): GoogleCapabilityDetails {
  const fields: Record<string, GoogleCapabilityDetail> = {}
  for (const [path, definition] of Object.entries<FieldDefinition>(GOOGLE_LOCATION_FIELDS)) {
    const eligibility = definition.metadataFlag
      ? metadataEligibility(input.location, definition.metadataFlag)
      : "unknown"
    const common = {
      support: definition.support,
      providerMethod: definition.providerMethod,
      eligibilitySource: definition.eligibilitySource,
      documentation: definition.documentation,
      ...(definition.handoffUrl ? { handoffUrl: definition.handoffUrl } : {}),
      eligibility,
      canValidate: false,
      documentationCheckedAt: GOOGLE_SUPPORT_CHECKED_AT,
      observedAt: input.observedAt,
    }
    switch (definition.support) {
      case "read_only":
        fields[path] = { ...common, eligibility: "not_applicable", canWrite: false, reasonCode: "provider_read_only" }
        break
      case "create_only":
        fields[path] = { ...common, eligibility: "not_applicable", canWrite: false, reasonCode: "immutable_after_creation" }
        break
      case "external":
        fields[path] = { ...common, canWrite: false, reasonCode: "managed_in_google" }
        break
      case "retired":
        fields[path] = { ...common, eligibility: "not_applicable", canWrite: false, reasonCode: "provider_capability_retired" }
        break
      case "supported": {
        const reasonCode = !input.canPublish ? "permission_denied"
          : !input.writesEnabled ? "publishing_paused"
          : eligibility === "ineligible" ? "location_ineligible"
          : eligibility === "unknown" ? "eligibility_unknown"
          : undefined
        fields[path] = {
          ...common,
          canWrite: input.canPublish && input.writesEnabled && eligibility === "eligible",
          canValidate: input.canPublish && input.writesEnabled && eligibility !== "ineligible",
          ...(reasonCode ? { reasonCode } : {}),
        }
        break
      }
    }
  }
  return { version: GOOGLE_SUPPORT_VERSION, fields }
}
