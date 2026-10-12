"use client"

import { LegalHoldsPanel } from "@/components/settings/legal-holds-panel"
import { PrivacyExportForm } from "@/components/settings/privacy-export-form"
import { PrivacyRequestsPanel } from "@/components/settings/privacy-requests-panel"
import { RetentionStatusCard } from "@/components/settings/retention-status-card"
import { privacyGating, type PrivacyAccess } from "@/lib/settings/gating"

/**
 * The Data and privacy settings area (plan P04-7). An owner works requests,
 * holds and exports; an admin reads requests, holds and retention status
 * and may log requests. The export is owner-only (its route is `roles:
 * ["owner"]`), so an admin is told rather than shown a form that would 403.
 */
export function PrivacySettings({ access }: { access: PrivacyAccess }) {
  const gating = privacyGating(access)
  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      <PrivacyRequestsPanel gating={gating} />
      {gating.canManagePrivacy ? (
        <PrivacyExportForm />
      ) : (
        <p className="text-caption text-ink-muted" data-slot="export-owner-only">
          Only an owner can fulfil requests, apply legal holds or export a
          subject’s records.
        </p>
      )}
      <LegalHoldsPanel gating={gating} />
      <RetentionStatusCard />
    </div>
  )
}
