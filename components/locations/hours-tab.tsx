"use client"

import { useCallback, useMemo, useRef, useState } from "react"

import { EditorFooter, type EditorStatus } from "@/components/editors/editor-footer"
import { EditorFrame } from "@/components/editors/editor-frame"
import { ReviewChangesSheet } from "@/components/editors/review-changes-sheet"
import { HoursEditor } from "@/components/locations/hours-editor"
import { LocationTab } from "@/components/locations/location-tab"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  fetchHours,
  publishHours,
  saveHours,
  type HoursState,
} from "@/lib/api/location-hours"
import { useEditorDraft } from "@/lib/editors/use-editor-draft"
import { usePublishFlow } from "@/lib/editors/use-publish-flow"
import { hoursFormSchema } from "@/lib/locations/forms/hours"
import type { TabGateReasons } from "@/lib/locations/gating"
import { hoursChangeRows } from "@/lib/locations/hours-diff"
import { queryKeys } from "@/lib/queries/keys"
import { useHours } from "@/lib/queries/use-location-hours"

const STATUS: Record<HoursState["status"], EditorStatus> = {
  in_sync: "in_sync",
  core_dirty: "unpublished",
  google_dirty: "google_dirty",
  conflict: "conflict",
}

export function HoursTab({ locationId }: { locationId: string }) {
  return (
    <LocationTab
      locationId={locationId}
      loadingLabel="opening hours"
      useResource={useHours}
      resource="hours"
    >
      {({ data: hours, disabled, editReason, publishReason }) => (
        <HoursForm
          // Remount on an external revision change so form-level error, sheet and
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
  const { draft, setDraft, isDirty, discard } = useEditorDraft({
    initial: hours.canonical,
    revision: hours.canonicalResource.revision,
    key: `location-hours-${locationId}`,
  })
  const [reviewOpen, setReviewOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const rows = useMemo(
    () =>
      hoursChangeRows({
        draft,
        google: hours.google,
        canonical: hours.canonical,
      }),
    [draft, hours.google, hours.canonical]
  )

  const needsAck =
    hours.status === "google_dirty" || hours.status === "conflict"

  /**
   * Save then publish, behind one button. The publish call needs the revision
   * and hash the save produces, so the two were always sequential; the operator
   * just had to know that and press them in order. Each step reports its own
   * result, because "saved but not published" is a real outcome an operator
   * must be able to see.
   */
  const saved = useRef<HoursState | null>(null)
  const buildSteps = useCallback(
    () => [
      {
        key: "save",
        label: "Save the schedule in NabaPresence",
        run: async () => {
          await saveHours(locationId, {
            expectedCanonicalRevision: hours.canonicalResource.revision,
            hours: draft,
          })
          saved.current = await fetchHours(locationId)
        },
      },
      {
        key: "publish",
        label: "Publish it to Google",
        run: async () => {
          const fresh = saved.current
          if (!fresh) throw new Error("The schedule was not saved.")
          // An empty mask means the saved schedule already matches Google —
          // nothing left to send, and the publish route would reject it.
          if (fresh.updateMask.length === 0) return
          await publishHours(locationId, {
            expectedCanonicalRevision: fresh.canonicalResource.revision,
            expectedCanonicalHash: fresh.canonicalHash,
            expectedGoogleHash: fresh.googleHash,
            approvedUpdateMask: fresh.updateMask,
            confirmOverwriteGoogleChanges: needsAck,
          })
        },
      },
    ],
    [locationId, draft, hours.canonicalResource.revision, needsAck]
  )

  const flow = usePublishFlow({
    steps: buildSteps,
    invalidate: [queryKeys.locationHours(locationId)],
    successToast: "Opening hours published to Google",
    onSuccess: () => setReviewOpen(false),
  })

  function review() {
    const parsed = hoursFormSchema.safeParse(draft)
    if (!parsed.success) {
      setFormError(
        parsed.error.issues[0]?.message ?? "Please check the opening hours."
      )
      return
    }
    setFormError(null)
    flow.reset()
    setReviewOpen(true)
  }

  const publishReason = editReason ?? gateReason

  return (
    <EditorFrame
      title="Opening hours"
      description={`The hours customers see on Google. Times are in ${hours.location.timezone}.`}
      statusLabel={
        hours.status === "in_sync" && !isDirty ? "In sync with Google" : undefined
      }
      tone="healthy"
      gateReason={editReason}
      footer={
        <EditorFooter
          status={isDirty ? "edited" : STATUS[hours.status]}
          isDirty={isDirty}
          onReview={review}
          onDiscard={discard}
          disabledReason={publishReason}
          hint={
            hours.status === "in_sync"
              ? "These hours match Google."
              : "Google holds a different schedule. Review to see what differs."
          }
        />
      }
    >
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

      <ReviewChangesSheet
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        rows={rows}
        locationName={hours.location.name}
        onPublish={() => void flow.publish()}
        publishing={flow.isPublishing}
        results={flow.results}
        error={flow.error}
      />
    </EditorFrame>
  )
}
