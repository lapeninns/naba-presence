"use client"

import { Globe } from "lucide-react"
import { useCallback, useMemo, useRef, useState } from "react"

import { CapabilityBanner } from "@/components/editors/capability-banner"
import { DiscardDialog } from "@/components/editors/discard-dialog"
import { DraftNotices } from "@/components/editors/draft-notices"
import {
  EditorFooter,
  type EditorStatus,
} from "@/components/editors/editor-footer"
import { EditorFrame } from "@/components/editors/editor-frame"
import { ReviewChangesSheet } from "@/components/editors/review-changes-sheet"
import { HoursEditor } from "@/components/locations/hours-editor"
import { LocationTab } from "@/components/locations/location-tab"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ValidationSummary } from "@/components/ui/validation-summary"
import {
  fetchHours,
  publishHours,
  saveHours,
  type HoursState,
} from "@/lib/api/location-hours"
import { reconcileLegacyHoursBoundaries } from "@/lib/domain/hours-vocabulary"
import { ApiClientError } from "@/lib/api/client"
import { editorGate } from "@/lib/editors/gate"
import {
  hoursPublishParts,
  hoursSelectionRequest,
  markHoursConflicts,
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
import {
  hoursChangeRows,
  type HoursChangeRow,
} from "@/lib/locations/hours-diff"
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
          // No remount on a revision change: useEditorDraft follows the new
          // revision itself, and keeps unsaved edits (asking whose to keep)
          // when a colleague's save lands mid-edit.
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

function leftOutNote(dirty: boolean) {
  return dirty
    ? "Your whole schedule is saved here first. Anything left out stays as Google has it now and waits for a later publish."
    : "Anything left out stays as Google has it now and waits for a later publish."
}

function isEmptySchedule(hours: HoursState["google"]) {
  return (
    hours.regular.every((day) => day.isClosed || day.periods.length === 0) &&
    hours.special.length === 0 &&
    hours.moreHours.length === 0
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
  const editor = useEditorDraft({
    initial: hours.canonical,
    revision: hours.canonicalResource.revision,
    key: `location-hours-${locationId}`,
  })
  const { draft, setDraft, isDirty, discard, expectSave } = editor
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewed, setReviewed] = useState<{
    hours: HoursState
    draft: HoursState["canonical"]
    dirty: boolean
    rows: ReturnType<typeof markHoursConflicts<HoursChangeRow>>
  } | null>(null)
  // The parts (days, dates, services) going out with this publish. Every
  // changed part starts ticked; anything unticked is still saved here.
  const [selectedParts, setSelectedParts] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [reconciling, setReconciling] = useState(false)
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

  // A row overwrites a Google change when its part changed on Google since
  // the last publish (or, with no per-part baseline, when the schedule did).
  const rows = useMemo(
    () =>
      markHoursConflicts(
        hoursChangeRows({
          draft,
          google: hours.google,
          canonical: hours.canonical,
          supportedHoursTypes: hours.supportedHoursTypes,
        }),
        hours
      ),
    [draft, hours]
  )
  const parts = useMemo(
    () => hoursPublishParts(rows, hours.supportedHoursTypes),
    [rows, hours.supportedHoursTypes]
  )
  // Part selection needs the Google part hashes to pin each part.
  const canSelectParts = Boolean(hours.googlePartHashes)
  const reviewRows = reviewed
    ? canSelectParts
      ? reviewed.rows.filter((row) => selectedParts.has(row.part))
      : reviewed.rows
    : rows

  /**
   * Save then publish, behind one button. The publish call needs the revision
   * and hash the save produces, so the two were always sequential. Each step
   * reports its own result, because "saved but not published" is a real
   * outcome an operator must be able to see.
   */
  const saved = useRef<HoursState | null>(null)
  const buildSteps = useCallback((): PublishStep[] => {
    saved.current = null
    if (!reviewed) return []
    const snapshot = reviewed
    const chosen = [...selectedParts]
    const needsAck = reviewRows.some((row) => row.state === "conflict")
    const steps: PublishStep[] = []
    if (snapshot.dirty) {
      steps.push({
        key: "save",
        kind: "local",
        label: "Save the schedule in NabaPresence",
        run: async () => {
          const response = await saveHours(locationId, {
            expectedCanonicalRevision:
              snapshot.hours.canonicalResource.revision,
            hours: snapshot.draft,
          })
          const fresh = await fetchHours(locationId)
          if (
            fresh.canonicalResource.revision !== response.revision ||
            fresh.googleHash !== snapshot.hours.googleHash ||
            hoursChangeRows({
              draft: snapshot.draft,
              google: fresh.canonical,
              canonical: fresh.canonical,
            }).length > 0
          ) {
            throw new ApiClientError(
              409,
              "hours_review_stale",
              "The schedule changed after review. Close this review, refresh, and review the current versions before publishing."
            )
          }
          expectSave()
          saved.current = fresh
        },
      })
    }
    steps.push({
      key: "publish",
      label: "Publish opening hours to Google",
      // The hours publish reads Google back and compares it before success.
      verified: true,
      run: async () => {
        const fresh = saved.current ?? snapshot.hours
        // An empty mask means the saved schedule already matches Google —
        // nothing left to send, and the publish route would reject it.
        if (fresh.updateMask.length === 0) return NOTHING_TO_SEND
        // Only the chosen days, dates and services; Google keeps the rest.
        const partial = canSelectParts
          ? hoursSelectionRequest(fresh, chosen)
          : null
        if (canSelectParts && !partial) return NOTHING_TO_SEND
        const result = await publishHours(locationId, {
          expectedCanonicalRevision: fresh.canonicalResource.revision,
          expectedCanonicalHash: fresh.canonicalHash,
          expectedGoogleHash: fresh.googleHash,
          approvedUpdateMask: fresh.updateMask,
          confirmOverwriteGoogleChanges: needsAck,
          ...partial,
        })
        if (result.status === "in_sync") return NOTHING_TO_SEND
      },
    })
    return steps
  }, [
    locationId,
    reviewed,
    expectSave,
    selectedParts,
    reviewRows,
    canSelectParts,
  ])

  const flow = usePublishFlow({
    steps: buildSteps,
    invalidate: [
      queryKeys.locationHours(locationId),
      queryKeys.listingSummary(locationId),
      queryKeys.listingSummaries,
      queryKeys.clientsAll,
      queryKeys.locationActivity(locationId),
    ],
    successToast: (outcome) => ({
      outcome,
      title:
        outcome === "confirmed_applied"
          ? "Opening hours live on Google"
          : "Opening hours sent to Google",
    }),
    onSuccess: () => setReviewOpen(false),
  })

  const save = useResourceMutation({
    mutationFn: async () => {
      const result = await saveHours(locationId, {
        expectedCanonicalRevision: hours.canonicalResource.revision,
        hours: draft,
      })
      expectSave()
      return result
    },
    invalidate: [
      queryKeys.locationHours(locationId),
      queryKeys.listingSummary(locationId),
      queryKeys.listingSummaries,
      queryKeys.clientsAll,
      queryKeys.locationActivity(locationId),
    ],
    successToast: { outcome: "saved_locally" },
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
    setReviewed({
      hours: structuredClone(hours),
      draft: structuredClone(draft),
      dirty: isDirty,
      rows: structuredClone(rows),
    })
    setSelectedParts(new Set(parts.map((part) => part.key)))
    setReviewOpen(true)
  }

  const publishReason =
    editReason ??
    gateReason ??
    (hours.publicationBlocked || hours.reconciliationRequired
      ? "Resolve the hours warnings and save the corrected schedule before publishing."
      : undefined)
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
          description="The saved schedule and Google differ. Review both versions before deciding which hours to publish."
        />
      ) : null}

      {!gate && googleEmpty && hours.status !== "conflict" ? (
        <CapabilityBanner
          tone="info"
          title="Google has no opening hours for this listing"
          description="Customers see “Hours not available”. Switch on the days the business opens, set the times, then publish."
        />
      ) : null}

      <DraftNotices drafts={[editor]} noun="these hours" />

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
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

      {hours.reconciliationRequired ? (
        <Alert variant="warning">
          <AlertTitle>Confirm saved closing days</AlertTitle>
          <AlertDescription>
            Some older periods did not store their ending day or date. Check
            Google’s current boundaries, review them here, and save. Any period
            with edited times must be confirmed manually.
          </AlertDescription>
          {!disabled ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={reconciling}
              onClick={async () => {
                setReconciling(true)
                try {
                  const fresh = await fetchHours(locationId)
                  setDraft((current) =>
                    reconcileLegacyHoursBoundaries(current, fresh.google)
                  )
                  setFormError(null)
                } catch (error) {
                  if (!(error instanceof Error)) throw error
                  setFormError(
                    "Google’s current closing boundaries could not be loaded. Your draft is unchanged. Try again."
                  )
                } finally {
                  setReconciling(false)
                }
              }}
            >
              {reconciling
                ? "Checking Google…"
                : "Match Google closing boundaries"}
            </Button>
          ) : null}
        </Alert>
      ) : null}

      <HoursEditor
        value={draft}
        onChange={setDraft}
        disabled={disabled}
        google={hours.google}
        errors={fieldErrors}
        supportedHoursTypes={hours.supportedHoursTypes}
      />

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
        rows={reviewRows}
        locationName={hours.location.name}
        selection={
          reviewed && canSelectParts
            ? {
                options: hoursPublishParts(
                  reviewed.rows,
                  reviewed.hours.supportedHoursTypes
                ),
                selected: selectedParts,
                onChange: (key, checked) =>
                  setSelectedParts((current) => {
                    const next = new Set(current)
                    if (checked) next.add(key)
                    else next.delete(key)
                    return next
                  }),
                note: leftOutNote(reviewed.dirty),
              }
            : undefined
        }
        onPublish={() => void flow.publish()}
        publishing={flow.isPublishing}
        results={flow.results}
        error={flow.error}
        publishDisabledReason={publishReason}
      />
    </EditorFrame>
  )
}
