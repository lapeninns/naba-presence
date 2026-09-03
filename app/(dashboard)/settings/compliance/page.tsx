import { AccessDenied } from "@/components/app-shell/access-denied"

import { LegalHoldsCard } from "@/components/settings/legal-holds-card"
import { PrivacyExportCard } from "@/components/settings/privacy-export-card"
import { PrivacyRequestsCard } from "@/components/settings/privacy-requests-card"
import { PageHeader } from "@/components/app-shell/page-frame"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Data and compliance · NabaPresence" }

export default async function SettingsCompliancePage() {
  const session = await getSession()
  // Owner + admin may view/create privacy requests; only owners manage (D5).
  if (!session || (session.role !== "owner" && session.role !== "admin")) {
    return <AccessDenied area="Compliance and privacy" />
  }
  const canManage = session.role === "owner"
  return (
    <div className="flex flex-col gap-10">
      <PageHeader title="Data and compliance" description="Handle data-subject requests, legal holds and record exports." />
      <PrivacyRequestsCard canManage={canManage} />
      {canManage ? <LegalHoldsCard /> : null}
      {canManage ? <PrivacyExportCard /> : null}
    </div>
  )
}
