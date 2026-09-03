import { AccessDeniedPage } from "@/components/app-shell/access-denied"
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { NewClientForm } from "@/components/clients/client-form"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "New client · NabaPresence" }

export default async function NewClientPage() {
  const session = await getSession()
  if (session && session.role !== "owner" && session.role !== "admin") {
    return <AccessDeniedPage area="Adding a client" />
  }

  return (
    <PageFrame>
      <PageHeader
        title="New client"
        eyebrow="Clients"
        description="Name the business you look after. You'll connect its Google Business Profile next."
      />
      <NewClientForm />
    </PageFrame>
  )
}
