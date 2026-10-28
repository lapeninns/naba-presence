"use client"

import Link from "next/link"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { TechnicalDetails } from "@/components/reviewed-write"
import { Button, buttonVariants } from "@/components/ui/button"
import { SectionHeader } from "@/components/ui/section-header"
import { TabLoading } from "@/components/locations/tab-states"
import { ApiClientError } from "@/lib/api/client"
import { verificationCompletionPayloadSchema } from "@/lib/contracts/google-verification-completion-review"
import { resourceDisabledReason } from "@/lib/locations/gating"
import { useGoogleVerificationState } from "@/lib/queries/use-google-verification-state"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { useSession } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"
import { AdministrationDenied } from "./administration-denied"
import { AdministrationProvider } from "./context"
import { ReviewedCompletionVerification } from "./verification-completion"
import {
  VerificationMerchantObservation,
  VerificationRequestHistory,
  verificationCheckTime,
} from "./verification-observation"
import { ReviewedStartVerification } from "./verification-start"
import { VerificationWorkspaceActions } from "./verification-workspace-actions"

export function VerificationTab({
  locationId,
  locationName = "",
}: {
  readonly locationId: string
  readonly locationName?: string
}) {
  const session = useSession()
  const role = session.data?.session?.role
  if (session.isError)
    return (
      <Alert variant="warning">
        <AlertTitle>Your access could not be checked</AlertTitle>
        <AlertDescription>
          Refresh your session before inspecting verification.
        </AlertDescription>
        <Button variant="secondary" onClick={() => void session.refetch()}>
          Check access again
        </Button>
      </Alert>
    )
  if (session.isPending)
    return <TabLoading label="Checking verification access…" />
  if (role !== "owner" && role !== "admin")
    return (
      <AdministrationDenied
        kind="verification"
        locationId={locationId}
        locationName={locationName}
      />
    )
  return (
    <VerificationWorkspace
      key={locationId}
      locationId={locationId}
      locationName={locationName}
    />
  )
}

function VerificationWorkspace({
  locationId,
  locationName,
}: {
  readonly locationId: string
  readonly locationName: string
}) {
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
  // The gate every send reads: unchanged, whatever the banners below show.
  const writeReason =
    reason ??
    (observationUnavailable
      ? "Check current Google verification state before reviewing or sending a request."
      : null)
  // One message per cause. While either read is still in flight nothing is
  // known yet, so no warning shows (sends stay blocked by `writeReason`). The
  // paused banner speaks only for a permissions cause; a missing Google read
  // says so once, in its own alert.
  const loading = caps.isPending || current.isPending
  const reconnect =
    current.error instanceof ApiClientError &&
    (current.error.reconnectRequired ||
      current.error.code === "google_reconnect_required")
  const checkAgain = () => void current.refetch()

  // A PIN Google is waiting for is the task on this page: when a pending
  // request can take one, PIN entry leads and the standing card follows.
  const pinExpected = (current.data?.verifications ?? []).some(
    (item) =>
      item.phase === "pending" &&
      verificationCompletionPayloadSchema.shape.method.safeParse(item.method)
        .success
  )
  // A verified listing with nothing pending has no verification task: lead
  // with the answer and keep the PIN, start and history tools one tap away.
  const pendingRequest =
    current.data?.merchant?.hasPendingVerification === true ||
    (current.data?.verifications ?? []).some((item) => item.phase === "pending")
  const verifiedAtRest =
    !current.isError &&
    current.data?.merchant?.hasVoiceOfMerchant === true &&
    !pendingRequest
  // Google asks for verification and nothing is waiting: starting one is the
  // next step, so it follows the answer and the PIN tools come after it.
  const startNext =
    !current.isError &&
    current.data?.merchant?.hasVoiceOfMerchant === false &&
    current.data.merchant.action === "verify" &&
    !pendingRequest
  // The start form's up-front hint; the server still decides (it refuses a
  // start on a verified or pending listing), so nothing is disabled by it.
  const standing = current.isError
    ? null
    : verifiedAtRest
      ? ("verified" as const)
      : pendingRequest
        ? ("pending" as const)
        : null
  const toolsOrder = ["pin", "start", "guidance", "history"] as const
  const order = pinExpected
    ? (["pin", "status", "start", "guidance", "history"] as const)
    : startNext
      ? (["status", "start", "pin", "guidance", "history"] as const)
      : (["status", "pin", "start", "guidance", "history"] as const)

  const sections = {
    status: (
      <section
        key="status"
        aria-labelledby="verification-status"
        className="flex min-w-0 flex-col gap-3"
      >
        <SectionHeader
          id="verification-status"
          title="How Google sees this listing"
          description="Whether Google confirms you manage it, and any verification requests."
        />
        {current.isPending && (
          <p role="status" className="text-ui text-ink-muted">
            Reading current verification state from Google…
          </p>
        )}
        {current.isError && (
          <Alert variant="warning">
            <AlertTitle>Current Google state could not be read</AlertTitle>
            <AlertDescription>
              {reconnect
                ? "Google access has expired. Reconnect the account, then check again. "
                : ""}
              {current.data
                ? "The details below are earlier observations, not a successful refresh."
                : "No current observation is available. This does not mean the listing is unverified or has no requests."}
              {reason
                ? " Saved outcomes stay available below."
                : " Changes stay paused until Google can be read; saved outcomes stay available below."}
            </AlertDescription>
            <AlertActions>
              {reconnect && (
                <Link
                  href="/settings/connections"
                  className={cn(buttonVariants({ variant: "secondary" }))}
                >
                  Reconnect Google
                </Link>
              )}
              <Button
                variant="secondary"
                pending={current.isFetching}
                pendingLabel="Checking Google…"
                onClick={checkAgain}
              >
                Check Google again
              </Button>
            </AlertActions>
          </Alert>
        )}
        {current.data && (
          <VerificationMerchantObservation
            state={current.data}
            onCheck={current.isError ? undefined : checkAgain}
            checking={current.isFetching}
          />
        )}
      </section>
    ),
    pin: (
      <section
        key="pin"
        aria-labelledby="verification-pin"
        className="flex min-w-0 flex-col gap-3"
      >
        <SectionHeader
          id="verification-pin"
          title={
            pinExpected ? "Enter the PIN from Google" : "PINs and saved reviews"
          }
          description="Enter a PIN Google sent, or pick up a PIN review you saved earlier."
        />
        <ReviewedCompletionVerification
          verifications={current.data?.verifications ?? []}
        />
      </section>
    ),
    start: (
      <section
        key="start"
        aria-labelledby="verification-start"
        className="flex min-w-0 flex-col gap-3"
      >
        <SectionHeader
          id="verification-start"
          title="Start a new verification"
          description="Check existing requests before starting another. Google decides which methods are eligible."
        />
        <ReviewedStartVerification standing={standing} />
      </section>
    ),
    guidance: (
      <section
        key="guidance"
        aria-labelledby="verification-guidance"
        className="flex min-w-0 flex-col gap-2"
      >
        <SectionHeader
          id="verification-guidance"
          title="Follow Google’s delivery instructions"
        />
        <p className="text-ui text-ink-secondary">
          Use the delivery and expiry instructions for the exact method. Some
          methods continue entirely in Google. Check the current request and
          saved outcome before asking for another; recover an uncertain send
          before replacing it.
        </p>
      </section>
    ),
    history: (
      <section
        key="history"
        aria-labelledby="verification-history"
        className="flex min-w-0 flex-col gap-3"
      >
        <SectionHeader
          id="verification-history"
          title="History"
          description={
            current.data
              ? `Requests Google returned when checked at ${verificationCheckTime(current.data.checkedAt)}. Saved results above can be newer than this check. Finishing a request does not by itself mean the listing is verified.`
              : "Requests Google returns when its current state can be read."
          }
        />
        {current.data ? (
          <VerificationRequestHistory
            verifications={current.data.verifications}
            checkedAt={current.data.checkedAt}
          />
        ) : (
          <p className="text-ui text-ink-muted">
            Verification history is unavailable until Google state can be read.
          </p>
        )}
      </section>
    ),
  }
  return (
    <AdministrationProvider
      locationId={locationId}
      locationName={locationName}
      disabled={false}
      publishReason={writeReason}
    >
      <VerificationWorkspaceActions>
        <div className="flex min-w-0 flex-col gap-6">
          {reason && !loading && (
            <Alert variant="warning">
              <AlertTitle>Verification changes are paused</AlertTitle>
              <AlertDescription>
                {reason} Saved reviews and outcomes remain available to
                authorised owners and admins.
              </AlertDescription>
              {caps.isError && (
                <Button variant="secondary" onClick={() => void caps.refetch()}>
                  Check publishing permissions again
                </Button>
              )}
            </Alert>
          )}
          {verifiedAtRest ? (
            <>
              {sections.status}
              <TechnicalDetails summary="Verification tools" list={false}>
                <div className="flex min-w-0 flex-col gap-6">
                  {toolsOrder.map((section) => sections[section])}
                </div>
              </TechnicalDetails>
            </>
          ) : (
            order.map((section) => sections[section])
          )}
        </div>
      </VerificationWorkspaceActions>
    </AdministrationProvider>
  )
}
