import { redirect } from "next/navigation"

import { AccessDenied } from "@/components/app-shell/access-denied"
import { PageHeader } from "@/components/app-shell/page-frame"
import { BillingCard } from "@/components/settings/billing-card"
import { SettingsNav } from "@/components/settings/settings-nav"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { getSession } from "@/lib/server/session"

import {
  BillingRouteDisabled,
  billingRoutesEnabled,
  billingRouteMetadata,
} from "../billing-disabled"

export function generateMetadata() {
  return billingRouteMetadata("Billing · NabaPresence")
}

/**
 * The owner Billing screen (plan P07-S6), where Stripe Checkout and the
 * Customer Portal return (lib/server/billing/checkout.ts
 * BILLING_RETURN_PATH). Shown only while BILLING_ENABLED is on; otherwise the
 * shared 404, decided before the session read (billing-disabled.tsx). A return
 * from Checkout goes to "Confirming subscription": the return itself
 * proves nothing until Stripe's state reaches the record.
 */
export default async function SettingsBillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!billingRoutesEnabled()) return <BillingRouteDisabled />
  const session = await getSession()
  if (!session || session.role !== "owner") {
    return <AccessDenied area="Billing" />
  }
  const { checkout } = await searchParams
  if (checkout === "returned") redirect("/settings/billing/confirming")
  return (
    <>
      <PageHeader
        title="Billing"
        description="Your plan, its limits and renewal, payment details and invoices. Only the workspace owner can change billing."
        tabs={<SettingsNav role={session.role} />}
      />
      <div className="flex flex-col gap-(--np-gap-section)">
        {checkout === "canceled" ? (
          <Alert variant="info" data-slot="checkout-canceled">
            <AlertTitle>Checkout was not completed</AlertTitle>
            <AlertDescription>
              Nothing was charged and nothing changed. You can subscribe again
              below.
            </AlertDescription>
          </Alert>
        ) : null}
        <BillingCard />
      </div>
    </>
  )
}
