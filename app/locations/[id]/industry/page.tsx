import { redirect } from "next/navigation"

/**
 * Retired segment: the industry console grouped fields by which Google API
 * served them (lodging, business calls, healthcare) rather than by what they
 * describe. They are now capability-gated sections of the profile editor.
 */
export default async function IndustryRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<never> {
  const { id } = await params
  redirect(`/locations/${id}`)
}
