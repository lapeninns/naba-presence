"use client"

import Link from "next/link"
import { SupportDetails } from "@/components/editors/support-details"
import { Button, buttonVariants } from "@/components/ui/button"
import type { OnboardingMatchLinkOperation } from "@/lib/contracts/google-onboarding-match-link"

export function OnboardingMatchLinkStatus({ value, refreshing, onRefresh, onReview }: {
  readonly value: OnboardingMatchLinkOperation
  readonly refreshing: boolean
  readonly onRefresh: () => void
  readonly onReview: (id: string) => void
}) {
  const title = {
    pending: "Existing listing link in progress",
    linked: "Existing Google listing linked",
    failed: "Existing listing link needs recovery",
  } satisfies Record<OnboardingMatchLinkOperation["state"], string>
  return <section aria-labelledby="match-link-status-heading" className="flex min-w-0 flex-col gap-3 rounded-(--np-radius-card) border border-line p-4">
    <h4 id="match-link-status-heading" className="text-title font-semibold">{title[value.state]}</h4>
    <p role="status" className="text-ui">{value.state === "linked"
      ? "This existing resource is linked to NabaPresence. Initial synchronisation is queued; linking does not prove that verification or synchronisation has completed."
      : value.state === "pending"
        ? "The saved operation is still pending. Refresh its status before taking another action. An interrupted operation can be recovered after its pending claim expires."
        : "The mapping transaction did not complete. Restore its review to retry the same intent, or resolve conflicts and generate a fresh review. No new public Google listing was created by this operation."}</p>
    {value.errorCode === "location_limit_reached" && <p className="text-ui text-ink-muted">This workspace has reached its plan&apos;s location limit. Unlink a location or change plan, then link again.</p>}
    {value.errorCode && <SupportDetails items={[`Recovery reason: ${value.errorCode}`]} />}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" pending={refreshing} pendingLabel="Refreshing link status…" onClick={onRefresh}>Refresh link status</Button>
      {value.state === "failed" && <Button variant="secondary" disabled={refreshing} onClick={() => onReview(value.reviewId)}>Restore link review</Button>}
      {value.state === "linked" && value.locationId && <Link href={`/listings/${value.locationId}`} className={buttonVariants({ variant: "secondary" })}>Open linked listing</Link>}
    </div>
  </section>
}
