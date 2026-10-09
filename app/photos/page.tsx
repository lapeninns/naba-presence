import { redirect } from "next/navigation"

import {
  flatRouteTarget,
  type FlatRouteSearchParams,
} from "@/lib/server/flat-route-redirect"

/** Retired flat route: photos belong to a location inside a client. */
export default async function PhotosRedirect({
  searchParams,
}: {
  searchParams: Promise<FlatRouteSearchParams>
}): Promise<never> {
  redirect(
    await flatRouteTarget("photos", {
      searchParams: await searchParams,
      moved: "photos",
    })
  )
}
