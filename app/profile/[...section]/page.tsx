import { redirect } from "next/navigation"

import {
  FLAT_SEGMENT_MAP,
  flatRouteTarget,
  type FlatRouteSearchParams,
} from "@/lib/server/flat-route-redirect"

/** Retires `/profile/<section>`; see the sibling index page for why it is here. */
export default async function ProfileSectionRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ section: string[] }>
  searchParams: Promise<FlatRouteSearchParams>
}): Promise<never> {
  const { section } = await params
  redirect(
    await flatRouteTarget(FLAT_SEGMENT_MAP[section[0] ?? ""] ?? "", {
      searchParams: await searchParams,
      moved: "profile",
    })
  )
}
