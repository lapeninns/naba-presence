import { redirect } from "next/navigation"

import {
  flatRouteTarget,
  type FlatRouteSearchParams,
} from "@/lib/server/flat-route-redirect"

// "Settings › Listing" administered a location from a page nowhere near it.
// Access and verification now live in the location workspace they belong to.
export default async function SettingsListingRedirect({
  searchParams,
}: {
  searchParams: Promise<FlatRouteSearchParams>
}): Promise<never> {
  redirect(
    await flatRouteTarget("people", {
      searchParams: await searchParams,
      moved: "listing",
    })
  )
}
