import { redirect } from "next/navigation"

import { flatRouteTarget } from "@/lib/server/flat-route-redirect"

// "Settings › Listing" administered a location from a page nowhere near it.
// Access and verification now live in the location workspace they belong to.
export default async function SettingsListingRedirect(): Promise<never> {
  redirect(await flatRouteTarget("people"))
}
