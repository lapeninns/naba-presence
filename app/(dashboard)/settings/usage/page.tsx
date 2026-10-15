import { PageHeader } from "@/components/app-shell/page-frame"
import { PlanUsageCard } from "@/components/settings/plan-usage-card"
import { SettingsNav } from "@/components/settings/settings-nav"
import { UsageCard } from "@/components/settings/usage-card"
import { getSession } from "@/lib/server/session"

import {
  BillingRouteDisabled,
  billingRoutesEnabled,
  billingRouteMetadata,
} from "../billing-disabled"

export function generateMetadata() {
  return billingRouteMetadata("Usage · NabaPresence")
}

/**
 * The shared Usage screen (plan P07-S6): AI reply credits in the current
 * credit period and linked locations against the plan, for every member.
 * Shown while BILLING_ENABLED is on; with billing off the credits card
 * stays on the Policy page as before.
 */
export default async function SettingsUsagePage() {
  if (!billingRoutesEnabled()) return <BillingRouteDisabled />
  const session = await getSession()
  return (
    <>
      <PageHeader
        title="Usage"
        description="AI reply credits in the current period, and the locations your plan covers."
        tabs={<SettingsNav role={session?.role ?? null} />}
      />
      <div className="flex flex-col gap-(--np-gap-section)">
        <UsageCard />
        <PlanUsageCard />
      </div>
    </>
  )
}
