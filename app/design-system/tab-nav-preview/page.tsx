"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { LocationTabNav } from "@/components/locations/location-tab-nav"
import { queryKeys } from "@/lib/queries/keys"

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
})
client.setQueryData(queryKeys.importReviewCounts, {
  counts: [
    { locationId: "loc-1", resourceType: "profile", pending: 3 },
    { locationId: "loc-1", resourceType: "food_menus", pending: 1 },
  ],
})

export default function TabNavPreview() {
  return (
    <QueryClientProvider client={client}>
      <div className="flex min-h-dvh flex-col gap-(--np-gap-section) bg-canvas px-5 py-6 md:px-(--np-page-pad-x) md:py-(--np-page-pad-y)">
        <div>
          <h1 className="text-title font-semibold text-ink">Old Crown Girton</h1>
          <p className="text-ui text-ink-muted">89 High Street, Girton, Cambridge</p>
        </div>
        <LocationTabNav locationId="loc-1" canManageConsoles />
        <div className="rounded-(--np-radius-card) bg-surface p-(--np-card-pad) text-ui text-ink-muted">
          Tab content
        </div>
      </div>
    </QueryClientProvider>
  )
}
