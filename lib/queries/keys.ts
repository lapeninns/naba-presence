export const queryKeys = {
  session: ["session"] as const,
  connections: ["connections"] as const,
  settings: ["settings"] as const,
  locations: ["locations"] as const,
  reviewCounts: (scope: string) => ["review-counts", scope] as const,
  reviews: (scope: string, filters: unknown) =>
    ["reviews", scope, filters] as const,
  reviewDetail: (id: string) => ["review-detail", id] as const,
  analytics: (kind: string, params: unknown) =>
    ["analytics", kind, params] as const,
}
