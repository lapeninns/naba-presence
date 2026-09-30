import type { GoogleResourceAction, GoogleResourceActions } from "@/lib/contracts/google-resource-actions"
import { RETIRED_GOOGLE_CAPABILITIES, GOOGLE_DEPRECATION_SOURCE } from "./google-support"

export const GOOGLE_RESOURCE_CATALOGUE_VERSION = "2026-09-30.2"
export const GOOGLE_RESOURCE_CATALOGUE_CHECKED_AT = "2026-09-30"
type WriteFamily = "profileWrites" | "media" | "posts" | "foodMenus" | "placeActions" | "performance"
type ResourceDefinition = {
  readonly providerResource: string
  readonly reference: string
  readonly reads: readonly string[]
  readonly writes: readonly string[]
  readonly writeFamily: WriteFamily
  readonly eligibilitySource: string
  readonly managerOnly?: boolean
}
const reference = "https://developers.google.com/my-business/reference/"

export const GOOGLE_RESOURCE_CATALOGUE = {
  businessInformation: { providerResource: "locations", reference: "businessinformation/rest/v1/locations", reads: ["get", "getGoogleUpdated"], writes: ["patch", "delete"], writeFamily: "profileWrites", eligibilitySource: "Current Google account access and exact locations.patch(validateOnly=true) payload validation" },
  locationCreation: { providerResource: "accounts.locations", reference: "businessinformation/rest/v1/accounts.locations", reads: ["list"], writes: ["create"], writeFamily: "profileWrites", eligibilitySource: "Current Google account access and accounts.locations.create(validateOnly=true)", managerOnly: true },
  categories: { providerResource: "categories", reference: "businessinformation/rest/v1/categories", reads: ["list", "batchGet"], writes: [], writeFamily: "profileWrites", eligibilitySource: "Category metadata for exact language and region" },
  chains: { providerResource: "chains", reference: "businessinformation/rest/v1/chains", reads: ["get", "search"], writes: [], writeFamily: "profileWrites", eligibilitySource: "Provider chain discovery does not establish affiliation" },
  matching: { providerResource: "googleLocations", reference: "businessinformation/rest/v1/googleLocations", reads: ["search"], writes: [], writeFamily: "profileWrites", eligibilitySource: "Account-scoped proposed-location matching", managerOnly: true },
  attributes: { providerResource: "locations", reference: "businessinformation/rest/v1/locations", reads: ["getAttributes"], writes: ["updateAttributes"], writeFamily: "profileWrites", eligibilitySource: "attributes.list metadata for category, country and language" },
  attributeMetadata: { providerResource: "attributes", reference: "businessinformation/rest/v1/attributes", reads: ["list"], writes: [], writeFamily: "profileWrites", eligibilitySource: "Provider category and country metadata" },
  lodging: { providerResource: "locations", reference: "lodging/rest/v1/locations", reads: ["getLodging"], writes: ["updateLodging"], writeFamily: "profileWrites", eligibilitySource: "Eligible lodging listing, current Google access and pinned writable schema", managerOnly: true },
  lodgingSuggestions: { providerResource: "locations.lodging", reference: "lodging/rest/v1/locations.lodging", reads: ["getGoogleUpdated"], writes: [], writeFamily: "profileWrites", eligibilitySource: "Eligible lodging listing and independent provider suggestion read", managerOnly: true },
  accounts: { providerResource: "accounts", reference: "accountmanagement/rest/v1/accounts", reads: ["get", "list"], writes: ["create", "patch"], writeFamily: "profileWrites", eligibilitySource: "Current Google account role and account type", managerOnly: true },
  accountAdmins: { providerResource: "accounts.admins", reference: "accountmanagement/rest/v1/accounts.admins", reads: ["list"], writes: ["create", "patch", "delete"], writeFamily: "profileWrites", eligibilitySource: "Current Google account role and exact admin target", managerOnly: true },
  locationAdmins: { providerResource: "locations.admins", reference: "accountmanagement/rest/v1/locations.admins", reads: ["list"], writes: ["create", "patch", "delete"], writeFamily: "profileWrites", eligibilitySource: "Current Google location role and exact admin target", managerOnly: true },
  invitations: { providerResource: "accounts.invitations", reference: "accountmanagement/rest/v1/accounts.invitations", reads: ["list"], writes: ["accept", "decline"], writeFamily: "profileWrites", eligibilitySource: "Current Google account and exact pending invitation", managerOnly: true },
  locationTransfer: { providerResource: "locations", reference: "accountmanagement/rest/v1/locations", reads: [], writes: ["transfer"], writeFamily: "profileWrites", eligibilitySource: "Current source and destination Google account access", managerOnly: true },
  verification: { providerResource: "locations", reference: "verifications/rest/v1/locations", reads: ["fetchVerificationOptions", "getVoiceOfMerchantState"], writes: ["verify"], writeFamily: "profileWrites", eligibilitySource: "Current method options, merchant standing and exact service context", managerOnly: true },
  verificationRequests: { providerResource: "locations.verifications", reference: "verifications/rest/v1/locations.verifications", reads: ["list"], writes: ["complete"], writeFamily: "profileWrites", eligibilitySource: "Exact pending request with EMAIL, PHONE_CALL, SMS or ADDRESS method", managerOnly: true },
  reviews: { providerResource: "accounts.locations.reviews", reference: "rest/v4/accounts.locations.reviews", reads: ["get", "list"], writes: ["updateReply", "deleteReply"], writeFamily: "profileWrites", eligibilitySource: "Verified listing, current Google access and exact review identity" },
  posts: { providerResource: "accounts.locations.localPosts", reference: "rest/v4/accounts.locations.localPosts", reads: ["get", "list"], writes: ["create", "patch", "delete"], writeFamily: "posts", eligibilitySource: "Current Google access, merchant standing and exact localPosts operation response; the deprecated metadata flag is no longer populated" },
  merchantMedia: { providerResource: "accounts.locations.media", reference: "rest/v4/accounts.locations.media", reads: ["get", "list"], writes: ["create", "patch", "delete", "startUpload"], writeFamily: "media", eligibilitySource: "Current Google access, merchant ownership and media/category support" },
  customerMedia: { providerResource: "accounts.locations.media.customers", reference: "rest/v4/accounts.locations.media.customers", reads: ["get", "list"], writes: [], writeFamily: "media", eligibilitySource: "Customer-contributed media is read-only through this resource" },
  foodMenus: { providerResource: "accounts.locations", reference: "rest/v4/accounts.locations", reads: ["getFoodMenus"], writes: ["updateFoodMenus"], writeFamily: "foodMenus", eligibilitySource: "location.metadata.canHaveFoodMenu and exact supported menu schema" },
  placeActions: { providerResource: "locations.placeActionLinks", reference: "placeactions/rest/v1/locations.placeActionLinks", reads: ["get", "list"], writes: ["create", "patch", "delete"], writeFamily: "placeActions", eligibilitySource: "placeActionTypeMetadata.list for exact location, country and action type" },
  placeActionMetadata: { providerResource: "placeActionTypeMetadata", reference: "placeactions/rest/v1/placeActionTypeMetadata", reads: ["list"], writes: [], writeFamily: "placeActions", eligibilitySource: "Provider action-type metadata for location/country" },
  performance: { providerResource: "locations", reference: "performance/rest/v1/locations", reads: ["fetchMultiDailyMetricsTimeSeries", "getDailyMetricsTimeSeries"], writes: [], writeFamily: "performance", eligibilitySource: "Provider metric coverage for exact location and dated range" },
  searchKeywords: { providerResource: "locations.searchkeywords.impressions.monthly", reference: "performance/rest/v1/locations.searchkeywords.impressions.monthly", reads: ["list"], writes: [], writeFamily: "performance", eligibilitySource: "Provider monthly coverage and threshold for exact location" },
  notifications: { providerResource: "accounts", reference: "notifications/rest/v1/accounts", reads: ["getNotificationSetting"], writes: ["updateNotificationSetting"], writeFamily: "profileWrites", eligibilitySource: "Current Google account access, configured Pub/Sub topic and active notification types", managerOnly: true },
} as const satisfies Readonly<Record<string, ResourceDefinition>>

export function resourceActionCapabilities(input: {
  readonly connected: boolean
  readonly canRead: boolean
  readonly canPublish: boolean
  readonly managerial: boolean
  readonly writesEnabled: Readonly<Record<WriteFamily, boolean>>
  readonly observations?: Readonly<Record<string, { readonly eligible: boolean | null; readonly observedAt: string }>>
}): GoogleResourceActions {
  const actions: Record<string, GoogleResourceAction> = {}
  for (const [resource, definition] of Object.entries<ResourceDefinition>(GOOGLE_RESOURCE_CATALOGUE)) {
    for (const [mode, methods] of [["read", definition.reads], ["write", definition.writes]] as const) {
      for (const action of methods) {
        const key = `${resource}.${action}`
        const observation = input.observations?.[key]
        const eligibility = observation?.eligible === true ? "eligible" : observation?.eligible === false ? "ineligible" : "unknown"
        const permitted = input.canRead && (!definition.managerOnly || input.managerial)
        const reasonCode = !input.connected ? "reconnect_required" : !permitted || (mode === "write" && !input.canPublish) ? "permission_denied"
          : mode === "write" && !input.writesEnabled[definition.writeFamily] ? "publishing_paused"
          : eligibility === "ineligible" ? "location_ineligible" : eligibility === "unknown" ? "eligibility_unknown"
          : mode === "read" && !definition.writes.length ? "provider_read_only" : undefined
        actions[key] = {
          resource, action, providerMethod: `${definition.providerResource}.${action}`,
          support: definition.writes.length ? "supported" : "read_only", mode,
          eligibility, eligibilitySource: definition.eligibilitySource,
          canRead: mode === "read" && input.connected && permitted && eligibility !== "ineligible",
          canWrite: mode === "write" && input.connected && permitted && input.canPublish && input.writesEnabled[definition.writeFamily] && eligibility === "eligible",
          ...(reasonCode ? { reasonCode } : {}), documentation: `${reference}${definition.reference}`,
          documentationCheckedAt: GOOGLE_RESOURCE_CATALOGUE_CHECKED_AT, observedAt: observation?.observedAt ?? null,
        }
      }
    }
  }
  for (const [resource, definition] of Object.entries(RETIRED_GOOGLE_CAPABILITIES)) {
    for (const providerMethod of definition.methods) {
      const action = providerMethod.split(".").at(-1) ?? providerMethod
      actions[`${resource}.${providerMethod}`] = { resource, action, providerMethod, support: "retired", mode: /^(get|list|search|reportInsights)/.test(action) ? "read" : "write", eligibility: "not_applicable", eligibilitySource: `Discontinued ${definition.discontinuedAt}`, canRead: false, canWrite: false, reasonCode: "provider_capability_retired", documentation: GOOGLE_DEPRECATION_SOURCE, documentationCheckedAt: GOOGLE_RESOURCE_CATALOGUE_CHECKED_AT, observedAt: null }
    }
  }
  actions["retailProducts.manage"] = { resource: "retailProducts", action: "manage", providerMethod: null, support: "external", mode: "handoff", eligibility: "unknown", eligibilitySource: "No supported retail product-catalogue mutation in the GBP API reference", canRead: false, canWrite: false, reasonCode: "managed_in_google", documentation: "https://developers.google.com/my-business/content/basic-setup", documentationCheckedAt: GOOGLE_RESOURCE_CATALOGUE_CHECKED_AT, observedAt: null, handoffUrl: "https://business.google.com/" }
  return { version: GOOGLE_RESOURCE_CATALOGUE_VERSION, actions }
}
