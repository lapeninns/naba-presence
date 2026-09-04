import { redirect } from "next/navigation"

/**
 * Retired segment: "Administration" held who-may-edit-the-listing, whether
 * Google had verified it, and three destructive operations, under a name that
 * described none of them. It is now Access and Verification.
 */
export default async function AdministrationRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<never> {
  const { id } = await params
  redirect(`/locations/${id}/access`)
}
