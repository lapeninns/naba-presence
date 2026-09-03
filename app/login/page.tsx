import { redirect } from "next/navigation"

// Legacy alias: /login -> /sign-in. Preserve the auth query so deep links,
// invitation context, initial mode and confirmation status survive the hop.
export default async function LoginPage({
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
  redirect(suffix ? `/sign-in?${suffix}` : "/sign-in")
}
