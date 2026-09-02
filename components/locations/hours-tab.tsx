"use client"

import { useState } from "react"

import { HoursEditor } from "@/components/locations/hours-editor"
import { LocationTab } from "@/components/locations/location-tab"
import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { SaveBar } from "@/components/locations/save-bar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  publishHours,
  saveHours,
  type HoursState,
} from "@/lib/api/location-hours"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { hoursFormSchema } from "@/lib/locations/forms/hours"
import type { TabGateReasons } from "@/lib/locations/gating"
import { useResetOnRevision } from "@/lib/locations/use-reset-on-revision"
import { queryKeys } from "@/lib/queries/keys"
import { useHours } from "@/lib/queries/use-location-hours"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

const STATUS_COPY: Record<HoursState["status"], string> = {
  in_sync: "In sync with Google",
  core_dirty: "You have unpublished changes",
  google_dirty: "Google changed independently",
  conflict: "Both sides changed — review before publishing",
}

export function HoursTab({ locationId }: { locationId: string }) {
  return (
    <LocationTab
      locationId={locationId}
      useResource={useHours}
      resource="hours"
    >
      {({ data: hours, disabled, editReason, publishReason }) => (
        <HoursForm
          // Remount on an external revision change so form-level error, dialog and
          // mutation state reset with the draft, as the pre-shell tab did.
          key={hours.canonicalResource.revision}
          locationId={locationId}
          hours={hours}
          disabled={disabled}
          editReason={editReason}
          publishReason={publishReason}
        />
      )}
    </LocationTab>
  )
}

function HoursForm({
  locationId,
  hours,
  disabled,
  editReason,
  publishReason: gateReason,
}: TabGateReasons & { locationId: string; hours: HoursState }) {
  const [draft, setDraft] = useResetOnRevision(
    hours.canonical,
    hours.canonicalResource.revision
  )
  const [publishOpen, setPublishOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const isDirty = JSON.stringify(draft) !== JSON.stringify(hours.canonical)
  useDirtyGuard({
    key: `location-hours-${locationId}`,
    isDirty,
    snapshot: () => JSON.stringify(draft),
  })

  // Nested per-field mapping is impractical for the weekly structure, so server
  // errors surface in the form-level Alert (plus the hook's toast).
  const save = useResourceMutation({
    mutationFn: () =>
      saveHours(locationId, {
        expectedCanonicalRevision: hours.canonicalResource.revision,
        hours: draft,
      }),
    invalidate: [queryKeys.locationHours(locationId)],
    successToast: "Opening hours saved",
    onSuccess: () => setFormError(null),
    onError: (_error, message) => setFormError(message),
  })

  const publish = useResourceMutation({
    mutationFn: (confirmOverwrite: boolean) =>
      publishHours(locationId, {
        expectedCanonicalRevision: hours.canonicalResource.revision,
        expectedCanonicalHash: hours.canonicalHash,
        expectedGoogleHash: hours.googleHash,
        approvedUpdateMask: hours.updateMask,
        confirmOverwriteGoogleChanges: confirmOverwrite,
      }),
    invalidate: [queryKeys.locationHours(locationId)],
    successToast: "Opening hours published to Google",
    onSuccess: () => {
      setPublishOpen(false)
      setFormError(null)
    },
    onError: (_error, message) => setFormError(message),
  })

  function submit() {
    const parsed = hoursFormSchema.safeParse(draft)
    if (!parsed.success) {
      setFormError(
        parsed.error.issues[0]?.message ?? "Please check the opening hours."
      )
      return
    }
    setFormError(null)
    save.mutate()
  }

  const needsAck =
    hours.status === "google_dirty" || hours.status === "conflict"
  const publishReason =
    gateReason ??
    (hours.status === "in_sync"
      ? "Opening hours already match Google."
      : isDirty
        ? "Save your changes before publishing."
        : null)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={hours.status === "in_sync" ? "secondary" : "warning"}>
          {STATUS_COPY[hours.status]}
        </Badge>
        <span className="text-caption text-muted-foreground">
          Times shown in {hours.location.timezone}.
        </span>
      </div>

      {hours.warnings.map((warning) => (
        <Alert key={warning} variant="warning">
          <AlertTitle>Heads up</AlertTitle>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ))}

      <HoursEditor value={draft} onChange={setDraft} disabled={disabled} />

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <SaveBar
        onSave={submit}
        onPublish={() => setPublishOpen(true)}
        isDirty={isDirty}
        saving={save.isPending}
        publishing={publish.isPending}
        editReason={editReason}
        publishReason={publishReason}
      />

      <OverwriteConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title="Publish opening hours to Google?"
        description="This updates the opening hours on your Google Business Profile to match NabaPresence."
        confirmLabel="Publish"
        requireAcknowledgement={needsAck}
        acknowledgementLabel="Google changed the opening hours independently. Overwrite them with the NabaPresence schedule."
        pending={publish.isPending}
        onConfirm={() => publish.mutate(needsAck)}
      />
    </div>
  )
}
