"use client"

import { EditorFrame } from "@/components/editors/editor-frame"
import { LocationTab } from "@/components/locations/location-tab"
import { SectionPanel } from "@/components/locations/section-panel"
import type { AdministrationState } from "@/lib/api/location-administration"
import { asRecord } from "@/lib/locations/google-values"
import { useAdministration } from "@/lib/queries/use-location-administration"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"

import { AdminsSection } from "./admins"
import { AdministrationProvider } from "./context"
import { DangerZone } from "./danger-zone"
import { CreateAdminDialog, InvitationsList } from "./invitations"
import { StartVerification, VerificationHistory } from "./verification"
import {
  GoogleUpdateSummary,
  VoiceOfMerchantSummary,
} from "./voice-of-merchant"

/**
 * The Google-side administration data, shared by the two segments that split
 * out of the old "Administration" console.
 *
 * That console put who-may-edit-the-listing, whether-it-is-verified and
 * three destructive Google operations on one page under a name that described
 * none of them. Who has access and whether Google trusts the listing are two
 * different questions asked at two different times, so they are now two tabs.
 *
 * The GET is owner/admin-only server-side; `requires` makes the shell gate the
 * query on canEditCanonical, so nobody else fires the request that would 403.
 */
function AdministrationShell({
  locationId,
  locationName,
  children,
}: {
  locationId: string
  locationName?: string
  children: (props: {
    state: AdministrationState
    editReason: string | null
  }) => React.ReactNode
}) {
  // The danger zone needs the location's display name for its typed-name
  // confirmation. The workspace layout already fetches this same directory
  // query, so this reuses that cache in production rather than firing a
  // second network round trip; a caller-supplied `locationName` (used by
  // tests) always wins.
  const role = useSessionRole()
  const directoryQuery = useLocationDirectory(role)
  const resolvedLocationName =
    locationName ??
    directoryQuery.data?.find((entry) => entry.id === locationId)?.name ??
    ""

  return (
    <LocationTab
      locationId={locationId}
      loadingLabel="access and verification"
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
          {children({ state, editReason })}
        </AdministrationProvider>
      )}
    </LocationTab>
  )
}

/** A titled group of the tab: a headline, then its list or card. */
function TabSection({
  title,
  description,
  className,
  children,
}: {
  title: string
  description?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={className ?? "flex flex-col gap-3"}>
      <div className="flex flex-col gap-1">
        <h3 className="text-title font-semibold text-ink">{title}</h3>
        {description ? (
          <p className="text-ui text-ink-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
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
    <AdministrationShell locationId={locationId} locationName={locationName}>
      {({ state, editReason }) => (
        <EditorFrame
          title="People with access"
          description="Who can edit this listing inside Google. These are Google accounts, not NabaPresence team members."
          gateReason={editReason}
        >
          <TabSection title="Location admins">
            <SectionPanel title="Location admins" result={state.locationAdmins}>
              {(data) => <AdminsSection data={data} />}
            </SectionPanel>
          </TabSection>

          <TabSection title="Account admins">
            <SectionPanel title="Account admins" result={state.accountAdmins}>
              {(data) => <AdminsSection data={data} />}
            </SectionPanel>
          </TabSection>

          <TabSection title="Invitations">
            <SectionPanel title="Invitations" result={state.invitations}>
              {(data) => <InvitationsList data={data} />}
            </SectionPanel>
            <div>
              <CreateAdminDialog />
            </div>
          </TabSection>

          <DangerZone />
        </EditorFrame>
      )}
    </AdministrationShell>
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
    <AdministrationShell locationId={locationId} locationName={locationName}>
      {({ state, editReason }) => (
        <EditorFrame
          title="Verification"
          description="Whether Google has confirmed this business is real, and what it is showing publicly as a result."
          gateReason={editReason}
        >
          <TabSection title="How Google sees this listing">
            <div className="divide-y divide-line-subtle overflow-hidden rounded-(--np-radius-card) bg-surface">
              <SectionPanel title="Voice of merchant" result={state.voice}>
                {(data) => <VoiceOfMerchantSummary data={asRecord(data)} />}
              </SectionPanel>
              <SectionPanel
                title="Suggested updates"
                result={state.googleUpdated}
              >
                {(data) => <GoogleUpdateSummary data={asRecord(data)} />}
              </SectionPanel>
            </div>
          </TabSection>

          <TabSection
            title="Verification history"
            className="flex max-w-lg flex-col gap-3"
          >
            <SectionPanel
              title="Verification history"
              result={state.verifications}
            >
              {(data) => <VerificationHistory data={asRecord(data)} />}
            </SectionPanel>
          </TabSection>

          <TabSection
            title="Start a new verification"
            className="flex max-w-lg flex-col gap-3"
          >
            <SectionPanel
              title="Verification options"
              result={state.verificationOptions}
            >
              {(data) => <StartVerification data={asRecord(data)} />}
            </SectionPanel>
          </TabSection>
        </EditorFrame>
      )}
    </AdministrationShell>
  )
}
