"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { SectionHeader } from "@/components/ui/section-header"
import { TabLoading } from "@/components/locations/tab-states"
import { resourceDisabledReason } from "@/lib/locations/gating"
import { useGoogleVerificationState } from "@/lib/queries/use-google-verification-state"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { useSession } from "@/lib/queries/use-session"
import { AdministrationDenied } from "./administration-denied"
import { AdministrationProvider } from "./context"
import { ReviewedCompletionVerification } from "./verification-completion"
import { VerificationMerchantObservation, VerificationRequestHistory, verificationCheckTime } from "./verification-observation"
import { ReviewedStartVerification } from "./verification-start"
import { VerificationWorkspaceActions } from "./verification-workspace-actions"

export function VerificationTab({ locationId, locationName = "" }: { readonly locationId: string; readonly locationName?: string }) {
  const session = useSession()
  const role = session.data?.session?.role
  if (session.isError) return <Alert variant="warning"><AlertTitle>Your access could not be checked</AlertTitle><AlertDescription>Refresh your session before inspecting verification.</AlertDescription><Button variant="secondary" onClick={() => void session.refetch()}>Check access again</Button></Alert>
  if (session.isPending) return <TabLoading label="Checking verification access…" />
  if (role !== "owner" && role !== "admin") return <AdministrationDenied kind="verification" locationId={locationId} locationName={locationName} />
  return <VerificationWorkspace key={locationId} locationId={locationId} locationName={locationName} />
}

function VerificationWorkspace({ locationId, locationName }: { readonly locationId: string; readonly locationName: string }) {
  const caps = useLocationCapabilities(locationId)
  const current = useGoogleVerificationState(locationId)
  const reason = caps.isError
    ? "Your current publishing permissions could not be checked. Check permissions again before sending."
    : !caps.data
      ? "Checking current publishing permissions."
      : !caps.data.canEditCanonical || !caps.data.canPublish
        ? "You do not have permission to send verification requests for this listing."
        : !caps.data.resources?.administration
          ? "Verification publishing availability has not been confirmed."
          : resourceDisabledReason(caps.data, "administration", true)
  const observationUnavailable = current.isError || !current.data
  const writeReason = reason ?? (observationUnavailable ? "Check current Google verification state before reviewing or sending a request." : null)

  return <AdministrationProvider locationId={locationId} locationName={locationName} disabled={false} publishReason={writeReason}>
    <VerificationWorkspaceActions><div className="flex min-w-0 flex-col gap-6">
      {writeReason && <Alert variant="warning"><AlertTitle>Verification changes are paused</AlertTitle><AlertDescription>{writeReason} Saved reviews and outcomes remain available to authorised owners and admins.</AlertDescription>{caps.isError && <Button variant="secondary" onClick={() => void caps.refetch()}>Check publishing permissions again</Button>}</Alert>}
      <section aria-labelledby="verification-status" className="flex min-w-0 flex-col gap-3">
        <SectionHeader id="verification-status" title="How Google sees this listing" description="Merchant standing and verification requests are checked independently." />
        {current.isPending && <p role="status" className="text-ui text-ink-muted">Reading current verification state from Google…</p>}
        {current.isError && <Alert variant="warning"><AlertTitle>Current Google state could not be read</AlertTitle><AlertDescription>{current.data ? "The details below are earlier observations, not a successful refresh." : "No current observation is available. This does not mean the listing is unverified or has no requests."} Inspect saved outcomes or use the current-state check below.</AlertDescription></Alert>}
        {current.data && <VerificationMerchantObservation state={current.data} />}
      </section>
      <section aria-labelledby="verification-pin" className="flex min-w-0 flex-col gap-3">
        <SectionHeader id="verification-pin" title="PIN completion and saved outcomes" description="Review supported pending PIN requests or recover recorded completions." />
        <div className="rounded-(--np-radius-card) border border-line bg-surface p-4"><ReviewedCompletionVerification verifications={current.data?.verifications ?? []} /></div>
      </section>
      <section aria-labelledby="verification-start" className="flex min-w-0 flex-col gap-3">
        <SectionHeader id="verification-start" title="Start a new verification" description="Check existing requests before starting another. Google decides which methods are eligible." />
        <div className="rounded-(--np-radius-card) border border-line bg-surface p-4"><ReviewedStartVerification /></div>
      </section>
      <section aria-labelledby="verification-guidance" className="flex flex-col gap-2 rounded-(--np-radius-card) border border-line bg-surface p-4">
        <h2 id="verification-guidance" className="text-title font-semibold text-ink">Follow Google’s delivery instructions</h2>
        <p className="text-ui text-ink-secondary">Use the delivery and expiry instructions for the exact method. Some methods continue entirely in Google. Check the current request and saved outcome before asking for another; recover an uncertain send before replacing it.</p>
      </section>
      <section aria-labelledby="verification-history" className="flex min-w-0 flex-col gap-3">
        <SectionHeader id="verification-history" title="History" description={current.data ? `Requests Google returned when checked at ${verificationCheckTime(current.data.checkedAt)}. Saved outcomes above can be newer than this check; completion does not establish current merchant standing.` : "Requests Google returns when its current state can be read."} />
        {current.data ? <VerificationRequestHistory verifications={current.data.verifications} checkedAt={current.data.checkedAt} /> : <p className="text-ui text-ink-muted">Verification history is unavailable until Google state can be read.</p>}
      </section>
    </div></VerificationWorkspaceActions>
  </AdministrationProvider>
}
