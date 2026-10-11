/**
 * Query keys. The scoping contract:
 *
 *   * Keys carry no user or organisation segment. One query client serves
 *     one session's scope: lib/queries/scope-reset.ts drops every cached
 *     query except `session` when the session's user, organisation, role,
 *     publish right or scope fingerprint changes, and switching
 *     organisation reloads the page as well.
 *   * Per-location editor and resource keys are rooted at one of
 *     ["locations", id], ["location-capabilities", id], ["listing-summary", id]
 *     or ["listing-change-requests", id]; per-client keys at ["clients", id].
 *     A refused or hidden read on `/api/locations/{id}` or `/api/clients/{id}`
 *     (a 403 from an access check, or the 404 a hidden location or client
 *     answers) drops exactly those roots (`resourcePrefixesForPath`); a 403
 *     to a write refetches them in place. A new per-location or per-client
 *     key must live under one of them, or be added there.
 *   * Cross-location lists (reviews, review counts, review detail, analytics,
 *     schedule occurrences) are not dropped by a per-location answer. They
 *     follow the session: every access-lost answer refetches it, and a
 *     changed scope token then clears them with everything else.
 */
export const queryKeys = {
  session: ["session"] as const,
  // One change's receipt (GET /api/mutations/{id}), by operation or intent id.
  mutationReceipt: (id: string) => ["mutation-receipt", id] as const,
  // Prefix of every per-client key, so creating, renaming or reassigning a
  // client invalidates the index and each hub in one call.
  clientsAll: ["clients"] as const,
  clients: ["clients", "list"] as const,
  clientsArchived: ["clients", "archived"] as const,
  client: (id: string) => ["clients", id] as const,
  clientSetup: (id: string) => ["clients", id, "setup"] as const,
  clientReportShares: (id: string) => ["clients", id, "report-shares"] as const,
  connections: ["connections"] as const,
  // Operational notifications: the per-viewer list and unread count, and the
  // viewer's own preferences. Rooted together so a read or resolve refreshes both.
  notificationsAll: ["operational-notifications"] as const,
  notifications: (filter: string) => ["operational-notifications", "list", filter] as const,
  notificationPreferences: ["operational-notifications", "preferences"] as const,
  operationsHealth: ["operations", "health"] as const,
  postSchedules: (locationId: string) => ["locations", locationId, "post-schedules"] as const,
  bulkChanges: ["bulk-changes"] as const,
  bulkChange: (id: string) => ["bulk-changes", id] as const,
  scheduleOccurrencesAll: ["schedule-occurrences"] as const,
  scheduleOccurrences: (params: Record<string, string | undefined>) => ["schedule-occurrences", params] as const,
  webhookFailures: ["operations", "webhook-failures"] as const,
  settings: ["settings"] as const,
  // Prefix of both AI credit keys, so a draft invalidates them together.
  aiCreditsAll: ["ai-credits"] as const,
  aiCredits: ["ai-credits", "balance"] as const,
  aiCreditsDaily: ["ai-credits", "daily"] as const,
  // Rooted at "location-directory", NOT "locations": React Query invalidation
  // is prefix-matched, so a directory key of ["locations"] would shadow every
  // ["locations", <id>, …] resource key below and make one import or unlink
  // drop every per-location tab cache in the app.
  locations: ["location-directory"] as const,
  locationsManagement: ["location-directory", "management"] as const,
  locationCapabilities: (id: string) => ["location-capabilities", id] as const,
  // Listing changes waiting for a second publisher (two-person mode). Its own
  // root, so a write anywhere that parked can refresh every location's panel
  // without knowing which location it was.
  listingChangeRequestsAll: ["listing-change-requests"] as const,
  listingChangeRequests: (id: string) =>
    ["listing-change-requests", id] as const,
  // The DB-only listing state. Rooted apart from the resource keys so an
  // editor's invalidation of ["locations", id, …] refreshes it explicitly.
  listingSummary: (id: string) => ["listing-summary", id] as const,
  listingSummaries: ["listing-summary", "all"] as const,
  locationProfile: (id: string) => ["locations", id, "profile"] as const,
  locationHours: (id: string) => ["locations", id, "hours"] as const,
  // Prefix of every `locationMedia(id, …)` key: the photos tab invalidates all
  // pages/filters of one location's media at once after an upload or refresh.
  locationMediaAll: (id: string) => ["locations", id, "media"] as const,
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
  // Prefixes of every `reviewCounts(scope)` / `reviews(scope, filters)` key.
  // Review writes (draft, verify, approve, publish, delete reply) change list
  // membership and counts under every scope and filter, so they invalidate
  // these rather than guessing the active filters.
  reviewCountsAll: ["review-counts"] as const,
  reviewsAll: ["reviews"] as const,
  reviewCounts: (scope: string) => ["review-counts", scope] as const,
  reviews: (scope: string, filters: unknown) =>
    ["reviews", scope, filters] as const,
  reviewDetail: (id: string) => ["review-detail", id] as const,
  analytics: (kind: string, params: unknown) =>
    ["analytics", kind, params] as const,
  settingsCapabilities: ["settings-capabilities"] as const,
  // The Data and privacy area. Rooted together so a fulfil (which can move a
  // hold's effect and the retention picture) refreshes all three. Scoped to
  // the organisation like every key here: switching organisation reloads the
  // page and with it the cache (components/app-shell/account-menu.tsx).
  privacyAll: ["privacy"] as const,
  privacyRequests: ["privacy", "requests"] as const,
  legalHolds: ["privacy", "legal-holds"] as const,
  retentionStatus: ["privacy", "retention-status"] as const,
  members: ["members"] as const,
  // Under the members prefix, so invalidating the team list refreshes it too.
  memberClientAccess: (userId: string) =>
    ["members", userId, "client-access"] as const,
  invitations: ["invitations"] as const,
  invitation: (token: string) => ["invitation", token] as const,
  googleAccounts: (connectionId: string | null) =>
    ["google-accounts", connectionId] as const,
  googleLocations: (accountName: string | null) =>
    ["google-locations", accountName] as const,
  notificationSetting: (accountId: string | null) =>
    ["notification-setting", accountId] as const,
  backfill: ["backfill"] as const,
}
