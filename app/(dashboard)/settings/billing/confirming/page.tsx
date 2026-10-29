import { AccessDenied } from "@/components/app-shell/access-denied"
import { PageHeader } from "@/components/app-shell/page-frame"
import { BillingConfirming } from "@/components/settings/billing-confirming"
import { SettingsNav } from "@/components/settings/settings-nav"
import { getSession } from "@/lib/server/session"

import {
  BillingRouteDisabled,
  billingRoutesEnabled,
  billingRouteMetadata,
} from "../../billing-disabled"

export function generateMetadata() {
  return billingRouteMetadata("Confirming subscription · NabaPresence")
}

/** Where a completed Checkout lands (plan P07-S6). Owner only. */
export default async function BillingConfirmingPage() {
  if (!billingRoutesEnabled()) return <BillingRouteDisabled />
  const session = await getSession()
  if (!session || session.role !== "owner") {
    return (
      <AccessDenied
        area="Billing"
        whoCanHelp="the owner"
        whoCanGrant="Owners"
      />
    )
  }
  return (
    <>
      <PageHeader
        title="Billing"
        description="Your plan, its limits and renewal, payment details and invoices. Only the workspace owner can change billing."
        tabs={<SettingsNav role={session.role} />}
      />
      <BillingConfirming />
    </>
  )
}
