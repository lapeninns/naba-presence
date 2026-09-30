import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ComponentProps } from "react"
import { afterEach, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  usePathname: () => "/listings/l1",
  notFound: vi.fn(),
}))
vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    children,
    ...rest
  }: ComponentProps<"a"> & { prefetch?: boolean }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock("@/components/editors/activity-drawer", () => ({
  ActivityDrawer: () => <button type="button">Activity</button>,
}))
vi.mock("@/components/listings/recent-activity", () => ({
  RecentActivity: () => <p>recent activity</p>,
}))

import { ListingOverview } from "@/components/listings/listing-overview"
import type { LocationCapabilities } from "@/lib/contracts/location-capabilities"
import {
  emptyListingSummary,
  type ListingSummary,
} from "@/lib/contracts/location-summary"
import * as summaryApi from "@/lib/api/location-summary"
import userEvent from "@testing-library/user-event"
import { queryKeys } from "@/lib/queries/keys"
import type { DirectoryEntry } from "@/lib/locations/directory"

afterEach(() => vi.restoreAllMocks())

it("recovers the failed initial overview summary through its retry action", async () => {
  const recovered: ListingSummary = {
    ...emptyListingSummary({ locationId: "l1", linked: true, verified: true }),
    photos: { count: 27, observedAt: new Date().toISOString() },
  }
  const request = vi
    .spyOn(summaryApi, "fetchListingSummary")
    .mockRejectedValueOnce(new Error("Synthetic summary failure"))
    .mockResolvedValue(recovered)
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  })
  const directory: DirectoryEntry[] = [
    {
      id: "l1",
      name: "Test venue",
      linked: true,
      clientId: "c1",
      clientName: "Test client",
    },
  ]
  client.setQueryData<DirectoryEntry[]>(
    queryKeys.locationsManagement,
    directory
  )
  client.setQueryData<DirectoryEntry[]>(queryKeys.locations, directory)
  client.setQueryData<LocationCapabilities>(
    queryKeys.locationCapabilities("l1"),
    { canEditCanonical: true, canPublish: true, resources: {} }
  )
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <ListingOverview locationId="l1" role="owner" />
    </QueryClientProvider>
  )
  expect(
    await screen.findByText("We couldn’t check where each area stands")
  ).toBeVisible()
  expect(
    screen.getByRole("link", { name: "Check Opening hours" })
  ).toHaveAttribute("href", "/listings/l1/hours")
  await user.click(screen.getByRole("button", { name: "Try again" }))
  expect(await screen.findByText("27 of your photos")).toBeVisible()
  expect(
    screen.queryByText("We couldn’t check where each area stands")
  ).not.toBeInTheDocument()
  expect(request).toHaveBeenCalledTimes(2)
  client.clear()
})
