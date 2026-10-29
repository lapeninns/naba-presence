"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react"

import { CapabilityBanner } from "@/components/editors/capability-banner"
import { DiscardDialog } from "@/components/editors/discard-dialog"
import { DraftNotices } from "@/components/editors/draft-notices"
import {
  EditorFooter,
  type EditorStatus,
} from "@/components/editors/editor-footer"
import { EditorFrame } from "@/components/editors/editor-frame"
import { formatTimeZoneLabel } from "@/lib/format"
import { useViewerTimeZone } from "@/lib/hooks/use-viewer-time-zone"
import { GoogleFreshness } from "@/components/editors/google-freshness"
import { ReviewChangesSheet } from "@/components/editors/review-changes-sheet"
import {
  HoursEditor,
  type HoursEditorHandle,
} from "@/components/locations/hours-editor"
import { LocationTab } from "@/components/locations/location-tab"
import { Button } from "@/components/ui/button"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { showToast } from "@/components/ui/toast"
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
import {
  hoursNotes,
  serviceNote,
  type HoursNote,
} from "@/lib/editors/hours-notes"
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
import { useHours, useRefreshHours } from "@/lib/queries/use-location-hours"
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

/**
 * Every non-blocking note about the schedule in ONE notice (see
 * `hoursNotes`): a single note reads as before; several become one list
 * under a count, so a phone shows one panel, not a stack of near-identical
 * banners, before the first day row. A note's action is drawn from
 * `actions` by its kind; a kind with no control (editing is off) is left out.
 */
function HoursNotice({
  notes,
  actions,
}: {
  notes: HoursNote[]
  actions: Partial<Record<NonNullable<HoursNote["action"]>, ReactNode>>
}) {
  if (notes.length === 0) return null
  if (notes.length === 1) {
    const note = notes[0]!
    const action = note.action ? actions[note.action] : null
    return (
      <Alert variant={note.tone}>
        <AlertTitle>{note.title ?? "Heads up"}</AlertTitle>
        <AlertDescription>{note.description}</AlertDescription>
        {action ? <AlertActions>{action}</AlertActions> : null}
      </Alert>
    )
  }
  return (
    <Alert
      variant={
        notes.some((note) => note.tone === "warning") ? "warning" : "info"
      }
    >
      <AlertTitle>{notes.length} things to know about these hours</AlertTitle>
      <AlertDescription>
        <ul className="mt-1 flex list-disc flex-col gap-2 pl-4">
          {notes.map((note) => {
            const action = note.action ? actions[note.action] : null
            return (
              <li key={note.key}>
                {note.title ? (
                  <strong className="font-semibold">{note.title}. </strong>
                ) : null}
                {note.description}
                {action ? <span className="mt-2 flex">{action}</span> : null}
              </li>
            )
          })}
        </ul>
      </AlertDescription>
    </Alert>
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
    scope: {
      resource: "location-hours",
      resourceId: locationId,
      schemaVersion: 1,
    },
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
  const [keepingGoogle, setKeepingGoogle] = useState(false)
  const latestDraft = useRef(draft)
  useEffect(() => {
    latestDraft.current = draft
  }, [draft])
  const refresh = useRefreshHours(locationId)
  // Once Google's hours are in the draft, "Keep Google’s hours" gives way to
  // a note, and focus on a removed button falls to the page. It moves to the
  // footer instead: its status says the draft changed, and its Save here (the
  // next tab stop) keeps it. With no footer, the frame takes it.
  const keptGoogleIn = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const frame = keptGoogleIn.current
    if (!frame) return
    keptGoogleIn.current = null
    // Focus the operator has moved on their own is left where it is.
    const active = document.activeElement
    if (active && active !== document.body) return
    ;(
      frame.querySelector<HTMLElement>("[data-slot=editor-footer]") ?? frame
    ).focus()
  })
  const [discardOpen, setDiscardOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // Validation shows after the first save or review attempt, then follows
  // every edit so a fixed field clears its message straight away.
  const [attempts, setAttempts] = useState(0)
  // A special day's fields sit in its sheet: a summary link opens it first.
  const editorRef = useRef<HoursEditorHandle>(null)

  const issues = useMemo(
    () => validateHours(draft, hours.supportedHoursTypes),
    [draft, hours.supportedHoursTypes]
  )
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
      run: async (intent) => {
        const fresh = saved.current ?? snapshot.hours
        // An empty mask means the saved schedule already matches Google —
        // nothing left to send, and the publish route would reject it.
        if (fresh.updateMask.length === 0) return NOTHING_TO_SEND
        // Only the chosen days, dates and services; Google keeps the rest.
        const partial = canSelectParts
          ? hoursSelectionRequest(fresh, chosen)
          : null
        if (canSelectParts && !partial) return NOTHING_TO_SEND
        const body = {
          expectedCanonicalRevision: fresh.canonicalResource.revision,
          expectedCanonicalHash: fresh.canonicalHash,
          expectedGoogleHash: fresh.googleHash,
          approvedUpdateMask: fresh.updateMask,
          confirmOverwriteGoogleChanges: needsAck,
          ...partial,
        }
        const result = await publishHours(locationId, body, {
          intentId: intent.idFor(body),
        })
        if (result.status !== "published") return NOTHING_TO_SEND
        return result
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
  // The zone is said only when it is not the viewer's own: "UK time" for a
  // manager abroad, nothing for someone on the venue's clock. It is the
  // Regular hours group's caption, on the times it qualifies.
  const viewerZone = useViewerTimeZone()
  const zoneLabel = formatTimeZoneLabel(
    hours.location.timezone,
    viewerZone ?? hours.location.timezone
  )
  const notes = hoursNotes(hours, {
    gated: Boolean(gate),
    googleEmpty,
    draftEmpty: isEmptySchedule(draft),
  })

  async function reconcile() {
    setReconciling(true)
    try {
      // Google's boundaries as they are now, not as last observed.
      const fresh = await fetchHours(locationId, undefined, { refresh: true })
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
  }

  /**
   * "Keep Google’s hours": Google's schedule as it is now becomes the draft.
   * It is read fresh through "Check Google now" (not the possibly stale
   * `hours.google`), so the change rows compare the draft with the same read
   * and an exact copy reads "No changes to publish". Nothing is saved: the
   * operator keeps it with Save here, the usual revision-checked save, or
   * discards it.
   */
  async function keepGoogle(event: ReactMouseEvent<HTMLElement>) {
    const before = draft
    const frame = event.currentTarget.closest<HTMLElement>(
      "[data-slot=editor-frame]"
    )
    setKeepingGoogle(true)
    try {
      const fresh = await refresh.mutateAsync()
      // The editor stays open during the read: an edit made meanwhile is
      // never overwritten, and an empty read never empties the draft.
      if (latestDraft.current !== before) {
        setFormError(
          "You edited the hours while Google was being read, so your draft was left as it is."
        )
        return
      }
      if (isEmptySchedule(fresh.google)) {
        setFormError(
          "Google now shows no opening hours, so your draft was left as it is."
        )
        return
      }
      setDraft(structuredClone(fresh.google))
      setFormError(null)
      keptGoogleIn.current = frame
      showToast({
        kind: "local",
        type: "info",
        title: "Google’s hours are in your draft",
        description:
          "Nothing is saved yet. Save here to keep them in NabaPresence.",
      })
    } catch (error) {
      if (!(error instanceof Error)) throw error
      setFormError(
        "Google’s current hours could not be loaded. Your draft is unchanged. Try again."
      )
    } finally {
      setKeepingGoogle(false)
    }
  }

  return (
    <EditorFrame
      title="Opening hours"
      titleHidden
      readView={Boolean(editReason)}
      footer={
        <EditorFooter
          status={isDirty ? "edited" : STATUS[hours.status]}
          // Something to publish only when the draft differs from Google:
          // edits that already match it leave "No changes to publish" and
          // Save here, not a Review that would send nothing.
          isDirty={rows.length > 0}
          canDiscard={isDirty}
          // A clean Google-side change is not "N changes not on Google":
          // the bar says "Changed on Google", as the header pill does.
          changeCount={
            !isDirty && hours.status === "google_dirty"
              ? undefined
              : rows.length
          }
          emptyOnGoogle={googleEmpty ? "No hours on Google" : undefined}
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

      <HoursNotice
        notes={notes}
        actions={
          disabled
            ? {}
            : {
                reconcile: (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    // Pending, not disabled: focus stays on the button while
                    // Google is read.
                    pending={reconciling}
                    pendingLabel="Checking Google…"
                    onClick={reconcile}
                  >
                    Match Google closing boundaries
                  </Button>
                ),
                // It replaces the whole draft, so it never runs over
                // unsaved edits: those are saved or discarded first.
                "keep-google": isDirty ? (
                  <span className="text-ui text-ink-secondary">
                    Save or discard your edits first to use Google’s hours.
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    pending={keepingGoogle}
                    pendingLabel="Checking Google…"
                    onClick={keepGoogle}
                  >
                    Keep Google’s hours
                  </Button>
                ),
              }
        }
      />

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
        onNavigate={(fieldId) => editorRef.current?.reveal(fieldId)}
      />

      <GoogleFreshness
        observedAt={hours.observedAt}
        refreshing={refresh.isPending}
        failed={refresh.isError}
        onRefresh={() => refresh.mutate()}
      />

      <HoursEditor
        ref={editorRef}
        value={draft}
        onChange={setDraft}
        disabled={disabled}
        google={hours.google}
        errors={fieldErrors}
        supportedHoursTypes={hours.supportedHoursTypes}
        timeZone={hours.location.timezone}
        timeZoneLabel={zoneLabel}
        serviceNote={serviceNote(hours.warnings)}
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
