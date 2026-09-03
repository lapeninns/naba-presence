import { redirect } from "next/navigation"

import { flatRouteTarget } from "@/lib/server/flat-route-redirect"

/** Retired flat route: photos belong to a location inside a client. */
export default async function PhotosRedirect(): Promise<never> {
  redirect(await flatRouteTarget("photos"))
}
