"use client"

import { ShieldIcon, UnplugIcon } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"

import { LocationTab } from "@/components/locations/location-tab"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { SectionHeader } from "@/components/ui/section-header"
import type { AdministrationState } from "@/lib/api/location-administration"
import { asArray, asRecord } from "@/lib/locations/google-values"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { queryKeys } from "@/lib/queries/keys"
import { useAdministration } from "@/lib/queries/use-location-administration"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"

import { AdminsSection } from "./admins"
import { AdministrationProvider } from "./context"
import { DangerZone } from "./danger-zone"
import { CreateAdminDialog, InvitationsList } from "./invitations"
import { AdministrationDenied, type ConsoleKind } from "./administration-denied"
import { AdministrationAccessWorkspace, useAdministrationAccess } from "./access-workspace"
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
      useResource={useAdministration}
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
  const { rosterUpdating } = useAdministrationAccess()
  const client = useQueryClient()
  if (rosterUpdating) return <span role="status">Updating from Google… Counts refresh when Google’s current list arrives.</span>
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

function InvitationsSummary({ state }: { state: AdministrationState }) {
  const { rosterUpdating } = useAdministrationAccess()
  if (rosterUpdating) return <>Updating from Google…</>
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
                    <p className="rounded-(--np-radius-card) border border-line bg-surface px-4 py-4 text-ui text-ink-muted">
                      No account-level admins.
                    </p>
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
