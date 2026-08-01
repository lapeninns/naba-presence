import { redirect } from "next/navigation"

// Legacy redirect (spec §4): /reviews -> /inbox, forwarding the query string so
// a bookmarked /reviews?queue=… lands on the same inbox view.
export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<never> {
  const params = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value)
    else if (Array.isArray(value) && value[0] !== undefined)
      query.set(key, value[0])
  }
  const suffix = query.toString()
  redirect(suffix ? `/inbox?${suffix}` : "/inbox")
}
