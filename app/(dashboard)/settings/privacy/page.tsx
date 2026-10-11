import { notFound } from "next/navigation"

import { AccessDenied } from "@/components/app-shell/access-denied"
import { PageHeader } from "@/components/app-shell/page-frame"
import { PrivacySettings } from "@/components/settings/privacy-settings"
import { SettingsNav } from "@/components/settings/settings-nav"
import { withTenant } from "@/lib/server/db"
import { isOrgFeatureEnabled } from "@/lib/server/org-features"
import { getSession } from "@/lib/server/session"
import { privacyAccessFromRole } from "@/lib/settings/gating"

export const metadata = { title: "Data and privacy · NabaPresence" }

/**
 * Owners manage and admins read the organisation's privacy requests, legal
 * holds, subject exports and retention status. Ships dark: the page is a 404
 * until the organisation's `privacy_settings` feature is on.
 */
export default async function SettingsPrivacyPage() {
  const session = await getSession()
  if (!session || (session.role !== "owner" && session.role !== "admin")) {
    return <AccessDenied area="Data and privacy" />
  }
  const enabled = await withTenant(session.organisationId, (sql) =>
    isOrgFeatureEnabled(sql, session.organisationId, "privacy_settings")
  )
  if (!enabled) notFound()
  return (
    <>
      <PageHeader
        title="Data and privacy"
        description="Requests from reviewers about their data, legal holds, subject exports and how long review content is kept."
        tabs={<SettingsNav role={session.role} />}
      />
      <PrivacySettings access={privacyAccessFromRole(session.role, enabled)} />
    </>
  )
}
