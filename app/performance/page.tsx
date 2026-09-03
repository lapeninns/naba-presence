import { redirect } from "next/navigation"

// Renamed: "Performance" described one location's numbers, while an agency
// reads across clients. Forwards its query so saved links keep their range.
export default async function PerformanceRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<never> {
  const params = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value)
    else if (Array.isArray(value) && value[0] !== undefined) query.set(key, value[0])
  }
  const suffix = query.toString()
  redirect(suffix ? `/reports?${suffix}` : "/reports")
}
