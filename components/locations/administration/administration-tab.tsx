"use client"

import { ShieldIcon, UnplugIcon } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useEffect, useRef } from "react"

import { SectionLoadError } from "@/components/locations/section-panel"
import type { AdministrationFailure } from "@/lib/contracts/location-administration"
import { describeActionError } from "@/lib/errors/action-errors"
import { LocationTab } from "@/components/locations/location-tab"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { SectionHeader } from "@/components/ui/section-header"
import type { AdministrationState } from "@/lib/api/location-administration"
import { asArray, asRecord } from "@/lib/locations/google-values"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { queryKeys } from "@/lib/queries/keys"
import { useAdministration } from "@/lib/queries/use-location-administration"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"

import { AdminsSection } from "./admins"
import { AdministrationProvider, useAdministrationSection } from "./context"
import { DangerZone } from "./danger-zone"
import { CreateAdminDialog, InvitationsList } from "./invitations"
import { AdministrationDenied, type ConsoleKind } from "./administration-denied"
import { AdministrationAccessWorkspace, StaleRosterPlaceholder, useAdministrationAccess } from "./access-workspace"
import { lifecycleEndedReason, lifecycleEndedTitle } from "./lifecycle-ended"
import { LifecycleWorkspace, useLifecycleContext } from "./lifecycle-workspace"

export { VerificationTab } from "./verification-tab"

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
  result: {
    data: unknown
    error: string | null
    failure?: AdministrationFailure
  }
  empty?: React.ReactNode
  children: (data: unknown) => React.ReactNode
}) {
  const retryHeading = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!result.error && retryHeading.current?.isConnected) {
      retryHeading.current.tabIndex = -1
      retryHeading.current.focus()
      retryHeading.current = null
    }
  }, [result.error])
  if (result.error) {
    return <AdministrationReadError title={title} failure={result.failure} onRetry={(button) => {
      const heading = button.closest("section")?.querySelector("h2, h3, h4")
      retryHeading.current = heading instanceof HTMLElement ? heading : null
    }} />
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

const ADMINISTRATION_RECOVERY: Record<AdministrationFailure, string> = {
  permission_denied:
    "Google denied access to this resource. Ask an owner of the Google account to check the connected login’s access. Waiting alone will not restore permission.",
  reconnect_required:
    "Google needs the connected login to sign in again or grant the required access. Check Google connections and reconnect that login.",
  not_found:
    "Google could not find this account or resource. Check that the connected login still manages the intended Google account.",
  transient:
    "Google is temporarily unreachable or limiting requests. Try again shortly.",
  unknown:
    "Google did not return this resource. Try again; if it keeps failing, ask an owner or admin to check the Google connection.",
}

function AdministrationReadError({
  title,
  failure,
  onRetry,
}: {
  title: string
  failure?: AdministrationFailure
  onRetry: (button: HTMLButtonElement) => void
}) {
  const { locationId } = useAdministrationSection()
  const query = useAdministration(locationId, { enabled: false })
  return (
    <SectionLoadError
      title={title}
      description={`We couldn’t load ${title.toLowerCase()}. ${ADMINISTRATION_RECOVERY[failure ?? "unknown"]}${query.isError ? ` The latest retry failed: ${describeActionError(query.error)}` : ""}`}
    >
      <Button
        variant="outline"
        size="sm"
        pending={query.isFetching}
        pendingLabel={`Retrying ${title.toLowerCase()}…`}
        onClick={(event) => { onRetry(event.currentTarget); void query.refetch() }}
      >
        Retry {title.toLowerCase()}
      </Button>
      <Link
        href="/settings/connections"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        Check Google connections
      </Link>
    </SectionLoadError>
  )
}

function AdministrationRefreshError({ locationId }: { locationId: string }) {
  const query = useAdministration(locationId, { enabled: false })
  if (!query.isError) return null
  return (
    <Alert variant="warning">
      <AlertDescription>
        {describeActionError(query.error)} The last loaded details are still
        shown.
      </AlertDescription>
      <AlertActions>
        <Button
          variant="outline"
          size="sm"
          pending={query.isFetching}
          pendingLabel="Retrying…"
          onClick={() => void query.refetch()}
        >
          Retry administration
        </Button>
      </AlertActions>
    </Alert>
  )
}

function useAdministrationWithCachedData(locationId: string) {
  const query = useAdministration(locationId)
  return { ...query, isError: query.isError && query.data === undefined }
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
  const lifecycle = useLifecycleContext()
  const lifecycleReason = lifecycle?.ended ? lifecycleEndedReason(lifecycle.ended) : lifecycle?.busy ? "A lifecycle action is in progress. Wait for its saved response before another Google change." : lifecycle?.unresolved ? "Resolve the saved lifecycle outcome before another Google change." : null
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
      useResource={useAdministrationWithCachedData}
      resource="administration"
      requires="canEditCanonical"
    >
      {({ data: state, disabled, editReason, publishReason }) => (
        <AdministrationProvider
          locationId={locationId}
          locationName={resolvedLocationName}
          disabled={disabled}
          publishReason={editReason ?? publishReason ?? lifecycleReason}
        >
          <AdministrationRefreshError locationId={locationId} />
          {children({
            state,
            editReason,
            publishReason: publishReason ?? lifecycleReason,
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

/**
 * The one notice for a location this account no longer manages: a confirmed
 * deletion or transfer. Otherwise the shared "changes are paused" line.
 */
function AccessNotice({ editReason, publishReason }: { editReason: string | null; publishReason: string | null }) {
  const ended = useLifecycleContext()?.ended
  if (ended)
    return (
      <Alert variant="destructive" icon={<UnplugIcon aria-hidden />}>
        <AlertTitle>{lifecycleEndedTitle(ended)}</AlertTitle>
        <AlertDescription>
          {lifecycleEndedReason(ended)} The people listed below were read from
          Google before this change and may no longer apply.
        </AlertDescription>
      </Alert>
    )
  return <WritesBlocked reason={editReason ? null : publishReason} />
}

function countOf(result: { data: unknown }, key: string): number {
  return asArray(asRecord(result.data)[key]).length
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * The roster header line. A failed Google read shows the count as
 * unavailable, never as 0, and never claims a successful read; a roster read
 * before a confirmed change says it is being read again.
 */
function PeopleSummary({ state, locationId }: { state: AdministrationState; locationId: string }) {
  const { rosterUpdating, rosterUnavailable } = useAdministrationAccess()
  const client = useQueryClient()
  if (rosterUpdating) return <span role="status">Updating from Google… Counts refresh when Google’s current list arrives.</span>
  if (rosterUnavailable) return <span role="status">Counts unavailable · Google’s list after the confirmed change could not be read</span>
  const peopleFailed = Boolean(state.locationAdmins.error || state.accountAdmins.error)
  const invitationsFailed = Boolean(state.invitations.error)
  const people = peopleFailed
    ? "People count unavailable"
    : plural(countOf(state.locationAdmins, "admins") + countOf(state.accountAdmins, "accountAdmins"), "person", "people")
  const invitations = invitationsFailed
    ? "invitation count unavailable"
    : plural(countOf(state.invitations, "invitations"), "invitation", "invitations")
  const readAt = client.getQueryState(queryKeys.locationAdministration(locationId))?.dataUpdatedAt
  const source = peopleFailed && invitationsFailed
    ? "Google could not be read"
    : peopleFailed || invitationsFailed
      ? "Part of this list could not be read from Google"
      : readAt
        ? `Read from Google at ${new Date(readAt).toLocaleTimeString("en-GB")}`
        : "Read from Google when this page opened"
  return <>{`${people} · ${invitations} · ${source}`}</>
}

/** The empty account-admin list, unless it was read before a confirmed change. */
function NoAccountAdmins() {
  const { rosterUpdating, rosterUnavailable } = useAdministrationAccess()
  if (rosterUpdating || rosterUnavailable) return <StaleRosterPlaceholder what="account admins" />
  return (
    <p className="rounded-(--np-radius-card) border border-line bg-surface px-4 py-4 text-ui text-ink-muted">
      No account-level admins.
    </p>
  )
}

function InvitationsSummary({ state }: { state: AdministrationState }) {
  const { rosterUpdating, rosterUnavailable } = useAdministrationAccess()
  if (rosterUpdating) return <>Updating from Google…</>
  if (rosterUnavailable) return <>Count unavailable</>
  if (state.invitations.error) return <>Count unavailable</>
  return <>{`${countOf(state.invitations, "invitations")} waiting`}</>
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
    <LifecycleWorkspace locationId={locationId} locationName={locationName}>
    <AdministrationShell
      kind="people"
      locationId={locationId}
      locationName={locationName}
    >
      {({ state, editReason, publishReason }) => {
        return (
          <AdministrationAccessWorkspace><div className="flex flex-col gap-6">
            <AccessNotice editReason={editReason} publishReason={publishReason} />

            <p className="text-caption text-ink-muted">
              These are the people Google lets manage this listing. Who can see
              it in NabaPresence is usually managed per client, from{" "}
              <Link href="/team" className="font-semibold text-ink underline">
                Team → Client access
              </Link>
              .
            </p>

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
                description={<PeopleSummary state={state} locationId={locationId} />}
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
                  asArray(asRecord(data).accountAdmins).length === 0 ? (
                    <NoAccountAdmins />
                  ) : (
                    <AdminsSection
                      data={data}
                      scope="account"
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
                description={<InvitationsSummary state={state} />}
              />
              <Sub title="Invitations" result={state.invitations}>
                {(data) => <InvitationsList data={data} />}
              </Sub>
            </section>

            <DangerZone />
          </div></AdministrationAccessWorkspace>
        )
      }}
    </AdministrationShell>
    </LifecycleWorkspace>
  )
}
