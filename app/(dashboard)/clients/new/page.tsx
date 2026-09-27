import { AccessDeniedPage } from "@/components/app-shell/access-denied"
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { NewClientForm } from "@/components/clients/client-form"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "New client · NabaPresence" }

export default async function NewClientPage({
  searchParams,
}: {
  searchParams: Promise<{ listing?: string | string[] }>
}) {
  const session = await getSession()
  if (session && session.role !== "owner" && session.role !== "admin") {
    return <AccessDeniedPage area="Adding a client" />
  }

  const { listing } = await searchParams
  const listingId =
    typeof listing === "string" && /^[a-zA-Z0-9_-]+$/.test(listing)
      ? listing
      : undefined

  return (
    <PageFrame width="narrow">
      <PageHeader
        title="New client"
        eyebrow="Clients"
        description={
          listingId
            ? "Name the business, then return to your listing to file it under the new client."
            : "Name the business you look after. You'll connect its Google Business Profile next."
        }
      />
      <NewClientForm listingId={listingId} />
    </PageFrame>
  )
}
