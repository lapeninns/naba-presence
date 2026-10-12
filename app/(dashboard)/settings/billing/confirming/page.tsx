import { notFound } from "next/navigation"

import { AccessDenied } from "@/components/app-shell/access-denied"
import { PageHeader } from "@/components/app-shell/page-frame"
import { BillingConfirming } from "@/components/settings/billing-confirming"
import { SettingsNav } from "@/components/settings/settings-nav"
import { getServerEnv } from "@/lib/server/env"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Confirming subscription · NabaPresence" }

/** Where a completed Checkout lands (plan P07-S6). Owner only. */
export default async function BillingConfirmingPage() {
  if (!getServerEnv().BILLING_ENABLED) notFound()
  const session = await getSession()
  if (!session || session.role !== "owner") {
    return <AccessDenied area="Billing" />
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
