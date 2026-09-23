import { AccessDeniedPage } from "@/components/app-shell/access-denied"
import { PageFrame } from "@/components/app-shell/page-frame"
import { ClientSettings } from "@/components/clients/client-settings"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Client settings · NabaPresence" }

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

  // The header names the client, so it is drawn by the settings component
  // once the client has loaded.
  return (
    <PageFrame>
      <ClientSettings clientId={clientId} />
    </PageFrame>
  )
}
