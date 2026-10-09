import { redirect } from "next/navigation"

import {
  flatRouteTarget,
  type FlatRouteSearchParams,
} from "@/lib/server/flat-route-redirect"

/**
 * Retires the flat `/profile` route.
 *
 * Deliberately at the app root rather than inside `(dashboard)`: that layout
 * awaits the database, so its shell HTML is already streaming by the time a
 * redirect thrown inside it is evaluated, and the browser is left showing the
 * new page's content at the old address. A shim outside the group redirects
 * before anything is flushed — the same reason `/reviews` and `/connections`
 * live here.
 */
export default async function ProfileIndexRedirect({
  searchParams,
}: {
  searchParams: Promise<FlatRouteSearchParams>
}): Promise<never> {
  redirect(
    await flatRouteTarget("", {
      searchParams: await searchParams,
      moved: "profile",
    })
  )
}
