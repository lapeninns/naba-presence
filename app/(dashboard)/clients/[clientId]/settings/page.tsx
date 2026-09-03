import { AccessDeniedPage } from "@/components/app-shell/access-denied"
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { ClientSettings } from "@/components/clients/client-settings"
import { getSession } from "@/lib/server/session"

export default async function ClientSettingsPage({
  params,
}: {
  params: Promise<{ clientId: string }>
}) {
  const { clientId } = await params
  const session = await getSession()
  if (session && session.role !== "owner" && session.role !== "admin") {
    return <AccessDeniedPage area="Client settings" />
  }

  return (
    <PageFrame>
      <PageHeader
        title="Client settings"
        eyebrow="Client"
        description="Rename the client, file its locations, or archive it."
      />
      <ClientSettings clientId={clientId} />
    </PageFrame>
  )
}
