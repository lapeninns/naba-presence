"use client"

import { Globe } from "lucide-react"
import { useCallback, useMemo, useRef, useState } from "react"

import { CapabilityBanner } from "@/components/editors/capability-banner"
import { DiscardDialog } from "@/components/editors/discard-dialog"
import {
  EditorFooter,
  type EditorStatus,
} from "@/components/editors/editor-footer"
import { EditorFrame } from "@/components/editors/editor-frame"
import { ReviewChangesSheet } from "@/components/editors/review-changes-sheet"
import { HoursEditor } from "@/components/locations/hours-editor"
import { LocationTab } from "@/components/locations/location-tab"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ValidationSummary } from "@/components/ui/validation-summary"
import {
  fetchHours,
  publishHours,
  saveHours,
  type HoursState,
} from "@/lib/api/location-hours"
import { editorGate } from "@/lib/editors/gate"
import {
  specialChangeRows,
  validateHours,
} from "@/lib/editors/hours-presentation"
import { useEditorDraft } from "@/lib/editors/use-editor-draft"
import {
  NOTHING_TO_SEND,
  usePublishFlow,
  type PublishStep,
} from "@/lib/editors/use-publish-flow"
import { hoursFormSchema } from "@/lib/locations/forms/hours"
import type {
  LocationCapabilities,
  TabGateReasons,
} from "@/lib/locations/gating"
import { hoursChangeRows } from "@/lib/locations/hours-diff"
import { queryKeys } from "@/lib/queries/keys"
import { useHours } from "@/lib/queries/use-location-hours"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

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
      {({ data: hours, caps, disabled, editReason, publishReason }) => (
        <HoursForm
          // Remount on an external revision change so form-level error, sheet and
          // mutation state reset with the draft, as the pre-shell tab did.
          key={hours.canonicalResource.revision}
          locationId={locationId}
          hours={hours}
          caps={caps}
          disabled={disabled}
          editReason={editReason}
          publishReason={publishReason}
        />
      )}
    </LocationTab>
  )
}

function isEmptySchedule(hours: HoursState["google"]) {
  return (
    hours.regular.every((day) => day.isClosed || day.periods.length === 0) &&
    hours.special.length === 0
  )
}

function HoursForm({
  locationId,
  hours,
  caps,
  disabled,
  editReason,
  publishReason: gateReason,
}: TabGateReasons & {
  locationId: string
  hours: HoursState
  caps: LocationCapabilities | undefined
}) {
  const { draft, setDraft, isDirty, discard } = useEditorDraft({
    initial: hours.canonical,
    revision: hours.canonicalResource.revision,
    key: `location-hours-${locationId}`,
  })
  const [reviewOpen, setReviewOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // Validation shows after the first save or review attempt, then follows
  // every edit so a fixed field clears its message straight away.
  const [attempts, setAttempts] = useState(0)

  const issues = useMemo(() => validateHours(draft), [draft])
  const fieldErrors = useMemo(() => {
    if (attempts === 0) return {}
    const map: Record<string, string> = {}
    for (const issue of issues) map[issue.fieldId] ??= issue.message
    return map
  }, [attempts, issues])

  const needsAck =
    hours.status === "google_dirty" || hours.status === "conflict"

  const rows = useMemo(() => {
    const input = {
      draft,
      google: hours.google,
      canonical: hours.canonical,
    }
    const all = [
      ...hoursChangeRows(input)
        .filter((row) => row.field !== "Special hours")
        .map((row) => ({ ...row, key: `day-${row.field}` })),
      ...specialChangeRows(input),
    ]
    // A row differs from the saved copy whenever a schedule was saved here
    // and not yet published; that is only "changed on Google" when the
    // server says Google moved (google_dirty / conflict).
    return needsAck
      ? all
      : all.map((row) => ({ ...row, state: "changed" as const }))
  }, [draft, hours.google, hours.canonical, needsAck])

  /**
   * Save then publish, behind one button. The publish call needs the revision
   * and hash the save produces, so the two were always sequential. Each step
   * reports its own result, because "saved but not published" is a real
   * outcome an operator must be able to see.
   */
  const saved = useRef<HoursState | null>(null)
  const buildSteps = useCallback((): PublishStep[] => {
    saved.current = null
    const steps: PublishStep[] = []
    if (isDirty) {
      steps.push({
        key: "save",
        kind: "local",
        label: "Save the schedule in NabaPresence",
        run: async () => {
          await saveHours(locationId, {
            expectedCanonicalRevision: hours.canonicalResource.revision,
            hours: draft,
          })
          saved.current = await fetchHours(locationId)
        },
      })
    }
    steps.push({
      key: "publish",
      label: "Publish opening hours to Google",
      run: async () => {
        const fresh = saved.current ?? hours
        // An empty mask means the saved schedule already matches Google —
        // nothing left to send, and the publish route would reject it.
        if (fresh.updateMask.length === 0) return NOTHING_TO_SEND
        await publishHours(locationId, {
          expectedCanonicalRevision: fresh.canonicalResource.revision,
          expectedCanonicalHash: fresh.canonicalHash,
          expectedGoogleHash: fresh.googleHash,
          approvedUpdateMask: fresh.updateMask,
          confirmOverwriteGoogleChanges: needsAck,
        })
      },
    })
    return steps
  }, [locationId, draft, hours, isDirty, needsAck])

  const flow = usePublishFlow({
    steps: buildSteps,
    invalidate: [queryKeys.locationHours(locationId)],
    successToast: "Opening hours sent to Google",
    onSuccess: () => setReviewOpen(false),
  })

  const save = useResourceMutation({
    mutationFn: () =>
      saveHours(locationId, {
        expectedCanonicalRevision: hours.canonicalResource.revision,
        hours: draft,
      }),
    invalidate: [queryKeys.locationHours(locationId)],
    successToast: "Saved here. Not on Google until you publish.",
    onSuccess: () => setFormError(null),
    onError: (_error, message) => setFormError(message),
  })

  /** True when the draft can go anywhere; otherwise the summary takes focus. */
  function checkDraft() {
    setAttempts((count) => count + 1)
    if (issues.length > 0) return false
    const parsed = hoursFormSchema.safeParse(draft)
    if (!parsed.success) {
      setFormError(
        parsed.error.issues[0]?.message ?? "Please check the opening hours."
      )
      return false
    }
    setFormError(null)
    return true
  }

  function review() {
    if (!checkDraft()) return
    flow.reset()
    setReviewOpen(true)
  }

  const publishReason = editReason ?? gateReason
  const gate = editorGate({
    caps,
    resource: "hours",
    editReason,
    publishReason: gateReason,
    noun: "these hours",
    savesHere: true,
  })
  const googleEmpty = isEmptySchedule(hours.google)

  return (
    <EditorFrame
      title="Opening hours"
      titleHidden
      footer={
        <EditorFooter
          status={isDirty ? "edited" : STATUS[hours.status]}
          isDirty={isDirty || rows.length > 0}
          canDiscard={isDirty}
          changeCount={rows.length}
          onReview={review}
          onDiscard={() => setDiscardOpen(true)}
          onSave={() => {
            if (checkDraft()) save.mutate()
          }}
          saving={save.isPending}
          saveDisabledReason={editReason}
          disabledReason={publishReason}
          // A role that can't edit gets the one view-only bar, not a row
          // of disabled buttons.
          readOnlyReason={editReason}
          hint={
            hours.status === "in_sync"
              ? "These hours match Google."
              : "Google holds a different schedule. Review to see what differs."
          }
        />
      }
    >
      {gate ? (
        <CapabilityBanner
          tone={gate.tone}
          title={gate.title}
          description={gate.description}
          code={gate.code}
        />
      ) : null}

      {!gate && hours.status === "conflict" ? (
        <CapabilityBanner
          tone="warning"
          title="Google holds a different schedule"
          description="Someone changed these hours on Google since NabaPresence last saved them. Review changes shows both; publishing replaces Google’s."
        />
      ) : null}

      {!gate && googleEmpty && hours.status !== "conflict" ? (
        <CapabilityBanner
          tone="info"
          title="Google has no opening hours for this listing"
          description="Customers see “Hours not available”. Switch on the days the business opens, set the times, then publish."
        />
      ) : null}

      <ValidationSummary
        errors={
          attempts > 0
            ? issues.map((issue) => ({
                fieldId: issue.fieldId,
                message: `${issue.label}: ${issue.message}`,
              }))
            : []
        }
        title={
          issues.length === 1
            ? "1 problem to fix before saving or publishing"
            : `${issues.length} problems to fix before saving or publishing`
        }
        focusKey={attempts}
      />

      <p className="flex flex-wrap items-center gap-2 text-ui text-ink-secondary">
        <Globe
          className="size-4 text-ink-muted"
          strokeWidth={1.75}
          aria-hidden
        />
        <span>
          Times are in{" "}
          <strong className="font-semibold text-ink">
            {hours.location.timezone}
          </strong>
          .
        </span>
      </p>

      {hours.warnings.map((warning) => (
        <Alert key={warning} variant="warning">
          <AlertTitle>Heads up</AlertTitle>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ))}

      <HoursEditor
        value={draft}
        onChange={setDraft}
        disabled={disabled}
        google={hours.google}
        errors={fieldErrors}
      />

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <DiscardDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        description="The schedule goes back to what NabaPresence last saved. Google is not affected."
        onConfirm={() => {
          discard()
          setAttempts(0)
          setFormError(null)
        }}
      />

      <ReviewChangesSheet
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        rows={rows}
        locationName={hours.location.name}
        onPublish={() => void flow.publish()}
        publishing={flow.isPublishing}
        results={flow.results}
        error={flow.error}
        publishDisabledReason={publishReason}
      />
    </EditorFrame>
  )
}
