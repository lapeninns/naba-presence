"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { Banner } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { billingBanner } from "@/lib/billing/presentation"
import { useBilling } from "@/lib/queries/use-billing"
import { cn } from "@/lib/utils"

const BILLING_PATH = "/settings/billing"

/**
 * The organisation-wide billing banner (plan P07-S6): shown on every page
 * while billing derives read-only or a failed payment is in its grace
 * period. It says what still works, and gives the owner the way to Billing;
 * everyone else is told who can fix it. Not shown on the Billing screens,
 * which say the same in full. A background read: if the overview cannot be
 * loaded the banner stays off, and the server still refuses what it must.
 */
export function BillingBanner() {
  const pathname = usePathname()
  const billing = useBilling({ background: true })
  const overview = billing.data
  if (!overview) return null
  if (pathname === BILLING_PATH || pathname?.startsWith(`${BILLING_PATH}/`)) {
    return null
  }
  const banner = billingBanner(overview)
  if (!banner) return null
  // The owner's Billing screen exists only while billing is switched on.
  const billingScreen = overview.checkout.reason !== "billing_disabled"
  return (
    <Banner
      tone={banner.tone}
      data-slot="billing-banner"
      action={
        overview.canManage && billingScreen ? (
          <Link
            href={BILLING_PATH}
            prefetch={false}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "pointer-coarse:min-h-11"
            )}
          >
            Go to Billing
          </Link>
        ) : null
      }
    >
      <p className="m-0 text-pretty">
        {banner.message}
        {overview.canManage ? null : (
          <span className="text-ink-secondary">
            {" "}
            Ask the workspace owner to update billing.
          </span>
        )}
      </p>
    </Banner>
  )
}
