import { redirect } from "next/navigation"

import { PageHeader } from "@/components/app-shell/page-frame"
import { OpsHealthPanel } from "@/components/settings/ops-health-panel"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Operations · NabaPresence" }

export default async function SettingsOpsPage() {
  const session = await getSession()
  if (!session || (session.role !== "owner" && session.role !== "admin")) {
    redirect("/settings")
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Operations"
        description="Sync freshness, webhook failures, publish attempts, and scheduler health for this organisation."
      />
      <OpsHealthPanel />
    </div>
  )
}
