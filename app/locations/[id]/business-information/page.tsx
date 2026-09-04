import { redirect } from "next/navigation"

/**
 * Retired segment: "Business info" was a second tab editing the same listing
 * as Profile, with its own save model. Its sections now live inside the profile
 * editor, so the old path lands there.
 *
 * The shim sits outside the (dashboard) group on purpose: a redirect thrown
 * inside that layout is soft, so the content would change while the address bar
 * kept the retired path.
 */
export default async function BusinessInformationRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<never> {
  const { id } = await params
  redirect(`/locations/${id}`)
}
