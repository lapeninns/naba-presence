"use client"

import Link from "next/link"
import { useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { AttributesSection } from "@/components/locations/business-information/attributes-section"
import { ContactSection } from "@/components/locations/business-information/contact-section"
import { IdentitySection } from "@/components/locations/business-information/identity-section"
import { PublishConfirmDialog } from "@/components/locations/business-information/publish-confirm-dialog"
import { LocationTab } from "@/components/locations/location-tab"
import { GateNote } from "@/components/locations/publish-gate"
import { Button } from "@/components/ui/button"
import { ApiClientError } from "@/lib/api/client"
import {
  publishBusinessAttributes,
  publishBusinessInformation,
  type BusinessInformationState,
  type GoogleAttribute,
} from "@/lib/api/location-business-information"
import { businessInformationPayloadSchema } from "@/lib/domain/business-information"
import {
  buildAttributesUpdate,
  buildLocationUpdate,
  draftFromLocation,
  fieldErrorsFromPayload,
  presentUnsupportedLeaves,
} from "@/lib/locations/business-information-draft"
import {
  attributesFromState,
  describeAttributeValue,
  locationDiffRows,
} from "@/lib/locations/google-values"
import { useResetOnRevision } from "@/lib/locations/use-reset-on-revision"
import { queryKeys } from "@/lib/queries/keys"
import { useBusinessInformation } from "@/lib/queries/use-location-business-information"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

export function BusinessInformationTab({ locationId }: { locationId: string }) {
  return (
    <LocationTab
      locationId={locationId}
      useResource={useBusinessInformation}
      resource="businessInformation"
    >
      {({ data: state, caps, disabled, editReason, publishReason }) => (
        <BusinessInformationForm
          locationId={locationId}
          state={state}
          // Editors stay disabled (without a reason) until the role is known,
          // so a member never sees a briefly-enabled field (gating.ts).
          disabled={!caps || disabled}
          editReason={editReason}
          publishReason={editReason ?? publishReason}
        />
      )}
    </LocationTab>
  )
}

function BusinessInformationForm({
  locationId,
  state,
  disabled,
  editReason,
  publishReason,
}: {
  locationId: string
  state: BusinessInformationState
  disabled: boolean
  editReason: string | null
  publishReason: string | null
}) {
  const queryClient = useQueryClient()
  const invalidateKey = queryKeys.locationBusinessInformation(locationId)

  const initial = useMemo(
    () => draftFromLocation(state.location),
    [state.location]
  )
  // Local edits survive incidental re-renders and reset only when the Google
  // hash advances (a refetch after a successful publish).
  const [draft, setDraft] = useResetOnRevision(initial, state.locationHash)

  const initialAttributes = useMemo(
    () => attributesFromState(state.attributes, state.attributeMetadata),
    [state.attributes, state.attributeMetadata]
  )
  const [attributesDraft, setAttributesDraft] = useResetOnRevision<
    Record<string, GoogleAttribute>
  >(initialAttributes, state.attributesHash)

  const locationUpdate = useMemo(
    () => buildLocationUpdate(initial, draft),
    [initial, draft]
  )
  const locationIssues = useMemo(
    () => fieldErrorsFromPayload(locationUpdate.payload),
    [locationUpdate.payload]
  )
  const attributesUpdate = useMemo(
    () =>
      buildAttributesUpdate(
        state.attributeMetadata,
        initialAttributes,
        attributesDraft
      ),
    [state.attributeMetadata, initialAttributes, attributesDraft]
  )

  const [locationConfirmOpen, setLocationConfirmOpen] = useState(false)
  const [attributesConfirmOpen, setAttributesConfirmOpen] = useState(false)

  // A stale-hash rejection means Google moved on: refetch so the next attempt
  // diffs against what is really there.
  function refetchIfStale(error: unknown, code: string) {
    if (error instanceof ApiClientError && error.code === code)
      void queryClient.invalidateQueries({ queryKey: invalidateKey })
  }

  const publishLocation = useResourceMutation({
    mutationFn: () =>
      publishBusinessInformation(locationId, {
        updateMask: locationUpdate.updateMask,
        payload: businessInformationPayloadSchema.parse(locationUpdate.payload),
        expectedGoogleHash: state.locationHash,
      }),
    invalidate: [invalidateKey],
    successToast: "Published to Google",
    onSuccess: () => setLocationConfirmOpen(false),
    onError: (error) => {
      setLocationConfirmOpen(false)
      refetchIfStale(error, "business_information_stale")
    },
  })

  const publishAttributes = useResourceMutation({
    mutationFn: () =>
      publishBusinessAttributes(locationId, {
        attributeMask: attributesUpdate.attributeMask,
        attributes: attributesUpdate.attributes,
        expectedGoogleHash: state.attributesHash,
      }),
    invalidate: [invalidateKey],
    successToast: "Attribute changes published to Google",
    onSuccess: () => setAttributesConfirmOpen(false),
    onError: (error) => {
      setAttributesConfirmOpen(false)
      refetchIfStale(error, "attributes_stale")
    },
  })

  const locationDiff = useMemo(
    () => locationDiffRows(locationUpdate.updateMask, initial, draft),
    [locationUpdate.updateMask, initial, draft]
  )
  const attributesDiff = useMemo(() => {
    const metaByName = new Map(
      state.attributeMetadata.map((m) => [m.parent, m])
    )
    return attributesUpdate.attributeMask.map((name) => {
      const meta = metaByName.get(name)
      return {
        key: name,
        label: meta?.displayName ?? name,
        currentValue: describeAttributeValue(meta, initialAttributes[name]),
        nextValue: describeAttributeValue(meta, attributesDraft[name]),
      }
    })
  }, [
    attributesUpdate.attributeMask,
    state.attributeMetadata,
    initialAttributes,
    attributesDraft,
  ])

  const unsupported = presentUnsupportedLeaves(state.location)
  const publishBlocked = Boolean(publishReason)

  return (
    <div className="flex flex-col gap-8">
      <p className="text-caption text-muted-foreground">
        Categories, attributes, address, and open status are managed here and
        publish straight to Google. Core name, phone, website, and description
        also sync via the{" "}
        <Link href={`/locations/${locationId}`} className="underline">
          Profile tab
        </Link>
        , which keeps the NabaPresence copy in step.
      </p>

      <GateNote reason={editReason} />

      <IdentitySection
        locationId={locationId}
        draft={draft}
        setDraft={setDraft}
        issues={locationIssues}
        disabled={disabled}
      />

      <ContactSection
        draft={draft}
        setDraft={setDraft}
        issues={locationIssues}
        disabled={disabled}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Button
            onClick={() => setLocationConfirmOpen(true)}
            disabled={
              publishBlocked ||
              locationUpdate.updateMask.length === 0 ||
              Object.keys(locationIssues).length > 0 ||
              publishLocation.isPending
            }
          >
            Publish to Google
          </Button>
        </div>
        <GateNote reason={editReason ? null : publishReason} />
      </div>

      <AttributesSection
        metadata={state.attributeMetadata}
        draft={attributesDraft}
        onChange={(next) =>
          setAttributesDraft((prev) => ({ ...prev, [next.name]: next }))
        }
        disabled={disabled}
        hasChanges={attributesUpdate.attributeMask.length > 0}
        publishDisabled={publishBlocked || publishAttributes.isPending}
        onPublish={() => setAttributesConfirmOpen(true)}
      />

      {unsupported.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-title font-semibold">Other Google details</h2>
          <p className="text-caption text-muted-foreground">
            Google holds additional information on this listing that can&apos;t
            be edited here yet.
          </p>
          <div className="flex flex-col gap-2">
            {unsupported.map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-0.5 text-ui">
                <span className="font-medium">{label}</span>
                <span className="text-caption text-muted-foreground">
                  Not editable here yet.
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <PublishConfirmDialog
        open={locationConfirmOpen}
        onOpenChange={setLocationConfirmOpen}
        title="Publish these details to Google?"
        rows={locationDiff}
        pending={publishLocation.isPending}
        onConfirm={() => publishLocation.mutate()}
      />
      <PublishConfirmDialog
        open={attributesConfirmOpen}
        onOpenChange={setAttributesConfirmOpen}
        title="Publish these attributes to Google?"
        rows={attributesDiff}
        pending={publishAttributes.isPending}
        onConfirm={() => publishAttributes.mutate()}
      />
    </div>
  )
}
