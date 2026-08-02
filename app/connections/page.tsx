import { redirect } from "next/navigation"

// Legacy redirect (spec §4): /connections -> /settings/connections, forwarding the
// query string so the OAuth callback's ?google=connected|error&status=… survives
// (audit C-2). The Google callback server-redirects to /connections?google=…, so
// dropping the query here would strand the connection-return state.
export default async function ConnectionsPage({
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
  redirect(suffix ? `/settings/connections?${suffix}` : "/settings/connections")
}
