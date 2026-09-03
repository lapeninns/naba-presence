import { redirect } from "next/navigation"

import { flatRouteTarget } from "@/lib/server/flat-route-redirect"

/** Retired flat route: posts belong to a location inside a client. */
export default async function PostsRedirect(): Promise<never> {
  redirect(await flatRouteTarget("posts"))
}
