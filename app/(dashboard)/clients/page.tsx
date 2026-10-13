import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { AllListingsLink } from "@/components/clients/all-listings-link"
import {
  ClientsCount,
  ClientsIndex,
  NewClientButton,
} from "@/components/clients/clients-index"
import { getSession } from "@/lib/server/session"
import { redirectOutOfClientLayer } from "@/lib/server/workspace-redirect"

export const metadata = { title: "Clients · NabaPresence" }

export default async function ClientsPage() {
  const session = await getSession()
  redirectOutOfClientLayer(session, "/clients")
  const canManage = session?.role === "owner" || session?.role === "admin"

  return (
    <PageFrame width="wide">
      <PageHeader
        title="Clients"
        meta={<ClientsCount />}
        description="Every business you look after, and what each one needs."
        actions={
          <>
            <AllListingsLink />
            {canManage ? <NewClientButton /> : null}
          </>
        }
      />
      <ClientsIndex role={session?.role ?? null} />
    </PageFrame>
  )
}
