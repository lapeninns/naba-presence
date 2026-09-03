import { PageFrame } from "@/components/app-shell/page-frame"
import { ClientHub } from "@/components/clients/client-hub"
import { getSession } from "@/lib/server/session"

export default async function ClientHubPage({
  params,
}: {
  params: Promise<{ clientId: string }>
}) {
  const { clientId } = await params
  const session = await getSession()
  const canManage = session?.role === "owner" || session?.role === "admin"

  return (
    <PageFrame width="wide">
      <ClientHub clientId={clientId} canManage={canManage} />
    </PageFrame>
  )
}
