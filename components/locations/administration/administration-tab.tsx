"use client"

import { LocationTab } from "@/components/locations/location-tab"
import { GateNote } from "@/components/locations/publish-gate"
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

export function AdministrationTab({
  locationId,
  locationName,
}: {
  locationId: string
  locationName?: string
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

  // D4: the GET is owner/admin-only server-side — `requires` makes the shell
  // gate the query itself on canEditCanonical, so a non-owner/admin never
  // fires the 403 request.
  return (
    <LocationTab
      locationId={locationId}
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
          <AdministrationSections state={state} editReason={editReason} />
        </AdministrationProvider>
      )}
    </LocationTab>
  )
}

function AdministrationSections({
  state,
  editReason,
}: {
  state: AdministrationState
  editReason: string | null
}) {
  return (
    <div className="flex flex-col gap-8">
      <GateNote reason={editReason} />

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Voice of merchant</h2>
        <SectionPanel title="Voice of merchant" result={state.voice}>
          {(data) => <VoiceOfMerchantSummary data={asRecord(data)} />}
        </SectionPanel>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Suggested updates</h2>
        <SectionPanel title="Suggested updates" result={state.googleUpdated}>
          {(data) => <GoogleUpdateSummary data={asRecord(data)} />}
        </SectionPanel>
      </section>

      <section className="flex max-w-lg flex-col gap-6">
        <h2 className="text-title font-semibold">Verification</h2>
        <div className="flex flex-col gap-2">
          <h3 className="text-ui font-semibold text-muted-foreground">
            Verification history
          </h3>
          <SectionPanel
            title="Verification history"
            result={state.verifications}
          >
            {(data) => <VerificationHistory data={asRecord(data)} />}
          </SectionPanel>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-ui font-semibold text-muted-foreground">
            Start a new verification
          </h3>
          <SectionPanel
            title="Verification options"
            result={state.verificationOptions}
          >
            {(data) => <StartVerification data={asRecord(data)} />}
          </SectionPanel>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-title font-semibold">Administrators</h2>
        <div className="flex flex-col gap-2">
          <h3 className="text-ui font-semibold text-muted-foreground">
            Location admins
          </h3>
          <SectionPanel title="Location admins" result={state.locationAdmins}>
            {(data) => <AdminsSection data={data} />}
          </SectionPanel>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-ui font-semibold text-muted-foreground">
            Account admins
          </h3>
          <SectionPanel title="Account admins" result={state.accountAdmins}>
            {(data) => <AdminsSection data={data} />}
          </SectionPanel>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-ui font-semibold text-muted-foreground">
            Invitations
          </h3>
          <SectionPanel title="Invitations" result={state.invitations}>
            {(data) => <InvitationsList data={data} />}
          </SectionPanel>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-ui font-semibold text-muted-foreground">
            Add an administrator
          </h3>
          <CreateAdminDialog />
        </div>
      </section>

      <DangerZone />
    </div>
  )
}
