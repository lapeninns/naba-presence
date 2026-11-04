import { PageHeader } from "@/components/app-shell/page-frame"
import { PlanUsageCard } from "@/components/settings/plan-usage-card"
import { UsageCard } from "@/components/settings/usage-card"

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
export default function SettingsUsagePage() {
  if (!billingRoutesEnabled()) return <BillingRouteDisabled />
  return (
    <>
      <PageHeader
        title="Usage"
        description="AI reply credits in the current period, and the locations your plan covers."
      />
      <div className="flex flex-col gap-(--np-gap-section)">
        <UsageCard />
        <PlanUsageCard />
      </div>
    </>
  )
}
