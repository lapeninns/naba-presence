import { redirect } from "next/navigation"

import {
  flatRouteTarget,
  type FlatRouteSearchParams,
} from "@/lib/server/flat-route-redirect"

/** Retired flat route: posts belong to a location inside a client. */
export default async function PostsRedirect({
  searchParams,
}: {
  searchParams: Promise<FlatRouteSearchParams>
}): Promise<never> {
  redirect(
    await flatRouteTarget("posts", {
      searchParams: await searchParams,
      moved: "posts",
    })
  )
}
