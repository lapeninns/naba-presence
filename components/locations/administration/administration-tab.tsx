"use client"

import {
  CopyIcon,
  LockIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  ShieldIcon,
  UnplugIcon,
} from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { LocationTab } from "@/components/locations/location-tab"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { SectionHeader } from "@/components/ui/section-header"
import type { AdministrationState } from "@/lib/api/location-administration"
import { listingHref } from "@/lib/listings/areas"
import { GATED_SECTION_TITLE } from "@/lib/locations/gating"
import { asArray, asRecord, asStringArray } from "@/lib/locations/google-values"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { useAdministration } from "@/lib/queries/use-location-administration"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"

import { AdminsSection } from "./admins"
import { AdministrationProvider } from "./context"
import { DangerZone } from "./danger-zone"
import { CreateAdminDialog, InvitationsList } from "./invitations"
import {
  PendingVerifications,
  StartVerification,
  VerificationHistory,
  pendingVerifications,
} from "./verification"
import {
  GoogleUpdateSummary,
  VoiceOfMerchantSummary,
} from "./voice-of-merchant"

/**
 * One `{ data, error }` sub-resource without a card of its own: the honest
 * warning when Google did not answer for it, a note when it is empty,
 * otherwise its content (which draws its own surface).
 */
function Sub({
  title,
  result,
  empty,
  children,
}: {
  title: string
  result: { data: unknown; error: string | null }
  empty?: React.ReactNode
  children: (data: unknown) => React.ReactNode
}) {
  if (result.error) {
    return (
      <Alert variant="warning">
        <AlertDescription>
          We couldn&apos;t load {title.toLowerCase()} from Google right now. Try
          refreshing in a moment.
        </AlertDescription>
      </Alert>
    )
  }
  if (result.data == null) {
    return (
      empty ?? (
        <p className="rounded-(--np-radius-card) border border-line bg-surface px-4 py-4 text-ui text-ink-muted">
          No {title.toLowerCase()} set.
        </p>
      )
    )
  }
  return <>{children(result.data)}</>
}

type ConsoleKind = "people" | "verification"

const DENIED_COPY: Record<ConsoleKind, { title: string; why: string }> = {
  people: {
    title: "Only owners and admins can see who has access",
    why: "People with access on Google decide who can change or delete the listing, so this page is limited to owners and admins.",
  },
  verification: {
    title: "Only owners and admins can manage verification",
    why: "Verification decides who Google trusts to speak for the business, so starting or completing it is limited to owners and admins.",
  },
}

/**
 * The page a member or viewer sees instead of a console. It never fires the
 * owner/admin-only GET. "Copy an access request" copies a sentence to the
 * clipboard for the person to paste to an owner or admin; nothing is sent.
 */
function AdministrationDenied({
  kind,
  locationId,
  locationName,
}: {
  kind: ConsoleKind
  locationId: string
  locationName: string
}) {
  const copy = DENIED_COPY[kind]
  const [copied, setCopied] = useState<"idle" | "copied" | "manual">("idle")
  const area = kind === "people" ? "People with access" : "Verification"
  const request = `Hi — could you give me access to ${area}${locationName ? ` for ${locationName}` : ""} in NabaPresence? It’s limited to owners and admins.`

  return (
    <div className="rounded-(--np-radius-card) border border-line bg-surface">
      <Empty
        icon={<LockIcon />}
        titleAs="h2"
        title={copy.title}
        description={`${GATED_SECTION_TITLE}. ${copy.why}`}
        action={
          <>
            <Link
              href={listingHref(locationId)}
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              Back to listing
            </Link>
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(request)
                  setCopied("copied")
                } catch {
                  setCopied("manual")
                }
              }}
            >
              <CopyIcon aria-hidden />
              Copy an access request
            </Button>
          </>
        }
      />
      <p
        role="status"
        className={cn(
          "px-5 text-center text-caption break-words text-ink-muted",
          copied !== "idle" && "-mt-4 pb-8"
        )}
      >
        {copied === "copied"
          ? "Copied. Paste it to an owner or admin — nothing was sent."
          : copied === "manual"
            ? `Copy this and send it to an owner or admin: “${request}”`
            : ""}
      </p>
    </div>
  )
}

/**
 * The Google-side administration data, shared by the two segments that split
 * out of the old "Administration" console.
 *
 * The GET is owner/admin-only server-side. A viewer the capabilities already
 * rule out sees the denied page here; otherwise `requires` makes the shell
 * gate the query on canEditCanonical, so nobody else fires the request that
 * would 403.
 */
function AdministrationShell({
  kind,
  locationId,
  locationName,
  children,
}: {
  kind: ConsoleKind
  locationId: string
  locationName?: string
  children: (props: {
    state: AdministrationState
    editReason: string | null
    publishReason: string | null
    locationName: string
  }) => React.ReactNode
}) {
  // The danger zone needs the location's display name for its typed-name
  // confirmation. The workspace layout already fetches this same directory
  // query, so this reuses that cache in production rather than firing a
  // second network round trip; a caller-supplied `locationName` (used by
  // tests) always wins.
  const role = useSessionRole()
  const directoryQuery = useLocationDirectory(role)
  const caps = useLocationCapabilities(locationId)
  const resolvedLocationName =
    locationName ??
    directoryQuery.data?.find((entry) => entry.id === locationId)?.name ??
    ""

  if (caps.data && !caps.data.canEditCanonical) {
    return (
      <AdministrationDenied
        kind={kind}
        locationId={locationId}
        locationName={resolvedLocationName}
      />
    )
  }

  return (
    <LocationTab
      locationId={locationId}
      loadingLabel={kind === "people" ? "people with access" : "verification"}
      useResource={useAdministration}
      resource="administration"
      requires="canEditCanonical"
    >
      {({ data: state, disabled, editReason, publishReason }) => (
        <AdministrationProvider
          locationId={locationId}
          locationName={resolvedLocationName}
          disabled={disabled}
          publishReason={editReason ?? publishReason}
        >
          {children({
            state,
            editReason,
            publishReason,
            locationName: resolvedLocationName,
          })}
        </AdministrationProvider>
      )}
    </LocationTab>
  )
}

/** The one line that says every change on this page is a Google write that is blocked, and why. */
function WritesBlocked({ reason }: { reason: string | null }) {
  if (!reason) return null
  return (
    <Alert variant="destructive" icon={<UnplugIcon aria-hidden />}>
      <AlertTitle>Changes here are paused</AlertTitle>
      <AlertDescription>
        {reason} What you see is Google’s last answer; nothing can be sent until
        this is resolved.
      </AlertDescription>
    </Alert>
  )
}

function countOf(result: { data: unknown }, key: string): number {
  return asArray(asRecord(result.data)[key]).length
}

/** Who may edit this listing on Google, and the operations that end it. */
export function AccessTab({
  locationId,
  locationName,
}: {
  locationId: string
  locationName?: string
}) {
  return (
    <AdministrationShell
      kind="people"
      locationId={locationId}
      locationName={locationName}
    >
      {({ state, editReason, publishReason }) => {
        const people =
          countOf(state.locationAdmins, "admins") +
          countOf(state.accountAdmins, "admins")
        const invitations = countOf(state.invitations, "invitations")
        return (
          <div className="flex flex-col gap-6">
            <WritesBlocked reason={editReason ? null : publishReason} />

            <Alert variant="info" icon={<ShieldIcon aria-hidden />}>
              <AlertTitle>Primary owner rules</AlertTitle>
              <AlertDescription>
                Google keeps exactly one primary owner per listing. The primary
                owner can’t be removed or demoted here, and a listing is never
                left without an owner. To hand over primary ownership, make
                someone an owner first, then transfer it on Google.
              </AlertDescription>
            </Alert>

            <section
              aria-labelledby="people-location"
              className="flex flex-col gap-3"
            >
              <SectionHeader
                id="people-location"
                title="People with access on Google"
                description={`${people} ${people === 1 ? "person" : "people"} · ${invitations} ${invitations === 1 ? "invitation" : "invitations"} · Read from Google when this page opened`}
                actions={<CreateAdminDialog />}
              />
              <Sub title="Location admins" result={state.locationAdmins}>
                {(data) => (
                  <AdminsSection
                    data={data}
                    caption="People with access to this listing on Google"
                  />
                )}
              </Sub>
            </section>

            <section
              aria-labelledby="people-account"
              className="flex flex-col gap-3"
            >
              <SectionHeader
                as="h3"
                id="people-account"
                title="Account admins"
                description="People who manage every listing in this Google account"
              />
              <Sub title="Account admins" result={state.accountAdmins}>
                {(data) =>
                  asArray(asRecord(data).admins).length === 0 ? (
                    <p className="rounded-(--np-radius-card) border border-line bg-surface px-4 py-4 text-ui text-ink-muted">
                      No account-level admins.
                    </p>
                  ) : (
                    <AdminsSection
                      data={data}
                      caption="People with access to the whole Google account"
                    />
                  )
                }
              </Sub>
            </section>

            <section
              aria-labelledby="people-invitations"
              className="flex flex-col gap-3"
            >
              <SectionHeader
                as="h3"
                id="people-invitations"
                title="Pending invitations"
                description={`${invitations} waiting`}
              />
              <Sub title="Invitations" result={state.invitations}>
                {(data) => <InvitationsList data={data} />}
              </Sub>
            </section>

            <DangerZone />
          </div>
        )
      }}
    </AdministrationShell>
  )
}

type VerificationMode = "verified" | "pending" | "unverified" | "unsupported"

/**
 * Reads Google's verification state again (a GET; nothing is sent to Google
 * but the question). The page otherwise only reads it when it opens.
 */
function CheckVerificationAgain({ locationId }: { locationId: string }) {
  const administration = useAdministration(locationId)
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => void administration.refetch()}
      pending={administration.isFetching}
      pendingLabel="Checking with Google…"
    >
      <RefreshCwIcon aria-hidden />
      Check with Google again
    </Button>
  )
}

/** Whether Google trusts this listing, and how to prove it again. */
export function VerificationTab({
  locationId,
  locationName,
}: {
  locationId: string
  locationName?: string
}) {
  return (
    <AdministrationShell
      kind="verification"
      locationId={locationId}
      locationName={locationName}
    >
      {({ state, editReason, publishReason, locationName: name }) => {
        const voice = asRecord(state.voice.data)
        const verified = voice.hasVoiceOfMerchant === true
        const history = asRecord(state.verifications.data)
        const pending = pendingVerifications(history).length > 0
        const options = asArray(
          asRecord(state.verificationOptions.data).options
        )
        const updatePaths = asStringArray(
          asRecord(asRecord(state.googleUpdated.data).diffMask).paths
        )
        const mode: VerificationMode = verified
          ? "verified"
          : pending
            ? "pending"
            : options.length > 0 || state.verificationOptions.error
              ? "unverified"
              : "unsupported"

        return (
          <div className="flex flex-col gap-6">
            <WritesBlocked reason={editReason ? null : publishReason} />

            <section
              aria-labelledby="verification-status"
              className="flex flex-col gap-3"
            >
              <SectionHeader
                id="verification-status"
                title="How Google sees this listing"
                description="Read from Google when this page opened"
              />
              <div className="flex flex-col divide-y divide-line overflow-hidden rounded-(--np-radius-card) border border-line bg-surface">
                <Sub title="Voice of merchant" result={state.voice}>
                  {(data) => <VoiceOfMerchantSummary data={asRecord(data)} />}
                </Sub>
                <div className="flex flex-col gap-0.5 px-4 py-3">
                  <span className="text-body text-ink">What it affects</span>
                  <span className="text-caption text-ink-muted">
                    {verified
                      ? "Edits publish normally, and posts and the food menu are available."
                      : "Some edits won’t show to customers, and some areas stay unavailable, until Google verifies the listing."}
                  </span>
                </div>
                {updatePaths.length > 0 || state.googleUpdated.error ? (
                  <Sub title="Suggested updates" result={state.googleUpdated}>
                    {(data) => <GoogleUpdateSummary data={asRecord(data)} />}
                  </Sub>
                ) : null}
              </div>
            </section>

            {mode === "verified" ? (
              <div className="rounded-(--np-radius-card) border border-line bg-surface">
                <Empty
                  className="py-8"
                  tone="ok"
                  icon={<ShieldCheckIcon />}
                  title={`Google has verified ${name || "this listing"}`}
                  description="Nothing to do here. If Google asks for verification again, it shows on the overview and here."
                />
              </div>
            ) : null}

            {mode === "pending" ? (
              <section
                aria-labelledby="verification-pin"
                className="flex flex-col gap-3"
              >
                <SectionHeader
                  id="verification-pin"
                  title="Enter the PIN from Google"
                  description="Google sent a PIN for the attempt below"
                />
                <PendingVerifications data={history} />
              </section>
            ) : null}

            {mode === "unsupported" ? (
              <Alert variant="warning">
                <AlertTitle>
                  Google has no verification methods for this listing right now
                </AlertTitle>
                <AlertDescription>
                  This happens when a listing was edited recently, is under
                  review by Google, or qualifies for bulk verification. Nothing
                  needs undoing; check again in a few days.
                </AlertDescription>
                <AlertActions>
                  <CheckVerificationAgain locationId={locationId} />
                </AlertActions>
              </Alert>
            ) : null}

            {mode !== "unsupported" ? (
              <section
                aria-labelledby="verification-start"
                className="flex flex-col gap-3"
              >
                <SectionHeader
                  id="verification-start"
                  title="Start a new verification"
                  description={
                    mode === "verified"
                      ? "Only needed if Google asks you to verify again."
                      : mode === "pending"
                        ? "Starting another attempt replaces the PIN on its way."
                        : "The methods Google offers for this listing today."
                  }
                />
                <Sub
                  title="Verification options"
                  result={state.verificationOptions}
                >
                  {(data) => (
                    <div className="rounded-(--np-radius-card) border border-line bg-surface p-4">
                      <StartVerification data={asRecord(data)} />
                    </div>
                  )}
                </Sub>
              </section>
            ) : null}

            {/* PIN advice only helps while a PIN can come: with no methods
                there is nothing to wait for or start again. */}
            {mode === "pending" || mode === "unverified" ? (
              <section
                aria-labelledby="verification-guidance"
                className="flex flex-col gap-2 rounded-(--np-radius-card) border border-line bg-surface p-4"
              >
                <h2
                  id="verification-guidance"
                  className="text-title font-semibold text-ink"
                >
                  If the PIN doesn’t arrive
                </h2>
                <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-ui text-ink-secondary">
                  <li>
                    Check where Google is sending it. If the phone number or
                    address is wrong, correct it in{" "}
                    <Link
                      href={listingHref(locationId, "profile")}
                      className="rounded-(--np-radius-tag) font-medium text-accent-ink underline-offset-3 focus-halo hover:underline"
                    >
                      Business profile
                    </Link>{" "}
                    and publish before starting again.
                  </li>
                  <li>
                    For a phone call or text message, wait ten minutes, then
                    start again with the same method.
                  </li>
                  <li>
                    For a postcard, wait at least 14 days before asking for
                    another; a new request cancels the old PIN.
                  </li>
                </ol>
              </section>
            ) : null}

            <section
              aria-labelledby="verification-history"
              className="flex flex-col gap-3"
            >
              <SectionHeader
                id="verification-history"
                title="History"
                description="Every attempt Google has on record"
              />
              <Sub title="Verification history" result={state.verifications}>
                {(data) => (
                  <VerificationHistory
                    data={asRecord(data)}
                    includePending={false}
                  />
                )}
              </Sub>
            </section>
          </div>
        )
      }}
    </AdministrationShell>
  )
}
