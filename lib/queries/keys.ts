export const queryKeys = {
  session: ["session"] as const,
  connections: ["connections"] as const,
  settings: ["settings"] as const,
  // Rooted at "location-directory", NOT "locations": React Query invalidation
  // is prefix-matched, so a directory key of ["locations"] would shadow every
  // ["locations", <id>, …] resource key below and make one import or unlink
  // drop every per-location tab cache in the app.
  locations: ["location-directory"] as const,
  locationsManagement: ["location-directory", "management"] as const,
  locationCapabilities: (id: string) => ["location-capabilities", id] as const,
  locationProfile: (id: string) => ["locations", id, "profile"] as const,
  locationHours: (id: string) => ["locations", id, "hours"] as const,
  locationMedia: (
    id: string,
    params: {
      page?: number
      category?: string | null
      ownership?: string | null
    } = {}
  ) =>
    [
      "locations",
      id,
      "media",
      params.page ?? 1,
      params.category ?? null,
      params.ownership ?? null,
    ] as const,
  locationActivity: (id: string, page = 1) =>
    ["locations", id, "activity", page] as const,
  locationBooking: (id: string) => ["locations", id, "booking"] as const,
  locationMenu: (id: string) => ["locations", id, "menu"] as const,
  locationImportReview: (id: string) =>
    ["locations", id, "import-review"] as const,
  importReviewCounts: ["import-review-counts"] as const,
  locationPosts: (id: string) => ["locations", id, "posts"] as const,
  locationBusinessInformation: (id: string) =>
    ["locations", id, "business-information"] as const,
  locationIndustry: (id: string) => ["locations", id, "industry"] as const,
  locationAdministration: (id: string) =>
    ["locations", id, "administration"] as const,
  businessInformationMetadata: (id: string, type: string, query: string) =>
    ["locations", id, "business-information", "metadata", type, query] as const,
  reviewCounts: (scope: string) => ["review-counts", scope] as const,
  reviews: (scope: string, filters: unknown) =>
    ["reviews", scope, filters] as const,
  reviewDetail: (id: string) => ["review-detail", id] as const,
  analytics: (kind: string, params: unknown) =>
    ["analytics", kind, params] as const,
  settingsCapabilities: ["settings-capabilities"] as const,
  members: ["members"] as const,
  invitations: ["invitations"] as const,
  privacyRequests: ["privacy-requests"] as const,
  legalHolds: ["legal-holds"] as const,
  operationsHealth: ["operations-health"] as const,
  webhookFailures: ["webhook-failures"] as const,
  googleAccounts: (connectionId: string | null) =>
    ["google-accounts", connectionId] as const,
  googleLocations: (accountName: string | null) =>
    ["google-locations", accountName] as const,
  notificationSetting: (accountId: string | null) =>
    ["notification-setting", accountId] as const,
  backfill: ["backfill"] as const,
}
