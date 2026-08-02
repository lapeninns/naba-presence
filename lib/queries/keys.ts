export const queryKeys = {
  session: ["session"] as const,
  connections: ["connections"] as const,
  settings: ["settings"] as const,
  locations: ["locations"] as const,
  locationsManagement: ["locations", "management"] as const,
  locationCapabilities: (id: string) => ["location-capabilities", id] as const,
  locationProfile: (id: string) => ["locations", id, "profile"] as const,
  locationHours: (id: string) => ["locations", id, "hours"] as const,
  locationMedia: (id: string) => ["locations", id, "media"] as const,
  locationBooking: (id: string) => ["locations", id, "booking"] as const,
  locationMenu: (id: string) => ["locations", id, "menu"] as const,
  locationPosts: (id: string) => ["locations", id, "posts"] as const,
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
  googleAccounts: (connectionId: string | null) =>
    ["google-accounts", connectionId] as const,
  googleLocations: (accountName: string | null) =>
    ["google-locations", accountName] as const,
  notificationSetting: (accountId: string | null) =>
    ["notification-setting", accountId] as const,
  backfill: ["backfill"] as const,
}
