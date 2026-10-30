"use client"

import { CheckIcon, RefreshCwIcon, Undo2Icon } from "lucide-react"
import Link from "next/link"
import { useId, useRef, useState } from "react"

import {
  changeRows,
  changeScope,
  formatDay,
} from "@/components/locations/suggestions/google-change-format"
import { GoogleWatchSettings } from "@/components/locations/suggestions/google-watch-settings"
import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { countNoun } from "@/components/ui/count-text"
import { DiffView } from "@/components/ui/diff-view"
import { ListRow } from "@/components/ui/list-row"
import { RelativeTime } from "@/components/ui/relative-time"
import { SettingsGroup } from "@/components/ui/settings-row"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { useToastManager } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import type {
  GoogleChange,
  GoogleChangeDecisionResponse,
  GoogleWatchSettingsResponse,
} from "@/lib/contracts/google-change-watch"
import {
  GOOGLE_CHANGE_RESOLUTION_LABELS,
  GOOGLE_CHANGE_STATUS_LABELS,
  WATCHED_FIELD_LABELS,
  isHoursField,
} from "@/lib/domain/google-change-watch-vocabulary"
import { describeActionError } from "@/lib/errors/action-errors"
import { listingHref } from "@/lib/listings/areas"
import {
  useApproveRestore,
  useDecideGoogleChange,
  useGoogleChanges,
  useGoogleWatchSettings,
  usePublishRestore,
} from "@/lib/queries/use-google-change-watch"
import { cn } from "@/lib/utils"

/**
 * Protected fields Google now shows differently from ours (the Google change
 * watch). Each row shows ours against what Google shows, with one action
 * each way: "Put ours back" makes a reviewed change that goes through the
 * usual approval and publishing, and "Keep Google’s" keeps Google’s value
 * as ours. Nothing changes on Google without a person publishing it, and
 * nothing is put back automatically.
 *
 * Reads only the database (GET /google-changes). The tab's one "Check
 * Google now", at the top of the tab (suggestions-page.tsx), runs the watch.
 */

const DECIDE_REASON =
  "Only owners and admins who can publish this listing can put ours back or keep Google’s."

const HISTORY_SHOWN = 5

function fieldTitle(change: GoogleChange) {
  const scope = changeScope(change)
  const label = WATCHED_FIELD_LABELS[change.field]
  return scope ? `${label}: ${scope}` : label
}

function lowerLabel(change: GoogleChange) {
  return WATCHED_FIELD_LABELS[change.field].toLowerCase()
}

/** What a decision did, and what (if anything) still has to happen. */
function outcomeToast(
  change: GoogleChange,
  outcome: GoogleChangeDecisionResponse["outcome"]
) {
  switch (outcome) {
    case "review_created":
      return {
        title: "Ours is ready to review",
        description:
          "It isn’t on Google yet. Approve and publish it here to put it back.",
      }
    case "awaiting_approval":
      return {
        title: "Sent for approval",
        description:
          "Ours goes back on Google once a second owner or admin approves.",
      }
    case "published":
      return {
        title: "Sent to Google",
        description: "This row updates after the next check with Google.",
      }
    case "accepted":
      return {
        title: `Kept Google’s ${lowerLabel(change)}`,
        description: "It’s our saved value now. Nothing was sent to Google.",
      }
  }
}

const SENT = {
  label: "Sent to Google, waiting for Google to confirm",
  detail: "Ours was sent. This row updates after the next check with Google.",
  tone: "pending" as const,
}

/** Where a "Put ours back" stands, from the change it made. */
function revertState(change: GoogleChange, now: number) {
  const revert = change.revert
  if (revert?.kind === "change_set") {
    if (revert.dispatched) return SENT
    if (Date.parse(revert.changeSet.expiresAt) <= now) {
      return {
        label: "Review expired",
        detail:
          "This review expired before it was published. It reopens after the next check with Google.",
        tone: "attention" as const,
      }
    }
    if (!revert.changeSet.approvedBy) {
      return {
        label: "Waiting for approval",
        detail: revert.changeSet.requiresSecondApprover
          ? "Prepared for review. A second owner or admin approves it, then it can be published. Nothing is on Google yet."
          : "Prepared for review. Approve it, then publish it. Nothing is on Google yet.",
        tone: "pending" as const,
      }
    }
    return {
      label: "Ready to publish",
      detail: "Approved. Publish it to put ours back on Google.",
      tone: "pending" as const,
    }
  }
  if (revert?.kind === "change_request") {
    if (revert.outcome === "awaiting_approval") {
      return {
        label: "Waiting for a second approval",
        detail:
          "Ours goes back on Google once a second owner or admin approves it in the hours editor.",
        tone: "pending" as const,
      }
    }
    if (revert.outcome === "failed" || revert.outcome === "rejected") {
      return {
        label: "Not put back",
        detail:
          "The request ended without reaching Google. It reopens after the next check with Google.",
        tone: "attention" as const,
      }
    }
    return SENT
  }
  return {
    label: "Being put back",
    detail: "An owner or admin is putting ours back.",
    tone: "pending" as const,
  }
}

function historyLabel(change: GoogleChange) {
  return change.status === "resolved" && change.resolution
    ? GOOGLE_CHANGE_RESOLUTION_LABELS[change.resolution]
    : GOOGLE_CHANGE_STATUS_LABELS[change.status]
}

function watchSummary(settings: GoogleWatchSettingsResponse | undefined) {
  if (!settings) return null
  const { protectedFields, alertMode } = settings.settings
  const fields =
    protectedFields.length === 0
      ? "Nothing is protected"
      : `${countNoun(protectedFields.length, "field")} protected`
  const audience =
    alertMode === "managers"
      ? "alerts go to owners and admins"
      : alertMode === "everyone"
        ? "alerts go to everyone who can see this listing"
        : "alerts go to chosen people"
  return `${fields} · ${audience}`
}

type Confirming = {
  change: GoogleChange
  action: "put_ours_back" | "accept_google"
}

export function GoogleChangesPanel({
  locationId,
  editReason = null,
}: {
  locationId: string
  /** The tab's own gate (a billing hold), shown as the reason when set. */
  editReason?: string | null
}) {
  const toasts = useToastManager()
  const query = useGoogleChanges(locationId)
  const settings = useGoogleWatchSettings(locationId)
  const decide = useDecideGoogleChange(locationId)
  const approve = useApproveRestore(locationId)
  const publish = usePublishRestore(locationId)
  const [confirming, setConfirming] = useState<Confirming | null>(null)
  const [failures, setFailures] = useState<Record<string, string>>({})
  const [showSettings, setShowSettings] = useState(false)
  const headingRef = useRef<HTMLSpanElement | null>(null)
  const settingsId = useId()
  // One clock per mount for expiry; a stale one only delays the label.
  const [now] = useState(() => Date.now())

  if (query.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        <p role="status" className="sr-only">
          Loading changes made on Google…
        </p>
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Alert variant="destructive">
          <AlertTitle>We couldn’t load changes made on Google</AlertTitle>
          <AlertDescription>
            Nothing was put back or kept. {describeActionError(query.error)}
          </AlertDescription>
        </Alert>
        {/* Outside the alert, so it reads what happened, not the button. */}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void query.refetch()}
        >
          <RefreshCwIcon aria-hidden />
          Try again
        </Button>
      </div>
    )
  }

  const { changes, canDecide, lastCheckedAt } = query.data
  const live = changes.filter(
    (change) => change.status === "open" || change.status === "reverting"
  )
  const past = changes.filter(
    (change) => change.status !== "open" && change.status !== "reverting"
  )
  const history = past.slice(0, HISTORY_SHOWN)
  const openCount = live.filter((change) => change.status === "open").length
  const gateReason = editReason ?? (canDecide ? undefined : DECIDE_REASON)
  const busy = decide.isPending || approve.isPending || publish.isPending
  const protectedCount = settings.data?.settings.protectedFields.length

  // The row that held the button may be gone (decided rows leave the list):
  // put focus somewhere that still exists.
  const settled = () => headingRef.current?.focus()

  const fail = (change: GoogleChange, error: unknown) => {
    const moved =
      error instanceof ApiClientError && error.code === "google_change_moved"
    const message =
      error instanceof Error && error.name === "RestoreNotConfirmedError"
        ? error.message
        : describeActionError(error)
    setFailures((current) => ({
      ...current,
      [change.id]: moved
        ? `${message} Google changed this again. Check Google now to see the latest.`
        : message,
    }))
  }

  const clearFailure = (change: GoogleChange) =>
    setFailures((current) => {
      const next = { ...current }
      delete next[change.id]
      return next
    })

  const runDecision = (
    change: GoogleChange,
    action: "put_ours_back" | "accept_google"
  ) =>
    decide.mutate(
      { changeId: change.id, action, expectedGoogleHash: change.googleHash },
      {
        onSuccess: (data) => {
          setConfirming(null)
          clearFailure(change)
          toasts.add({
            ...outcomeToast(change, data.outcome),
            type: "success",
          })
          settled()
        },
        onError: (error) => {
          setConfirming(null)
          fail(change, error)
        },
      }
    )

  const startDecision = (
    change: GoogleChange,
    action: "put_ours_back" | "accept_google"
  ) => {
    // Putting hours back can publish at once, and keeping Google's replaces
    // a saved value: both ask first. A profile field's put-back only makes a
    // review, which is its own confirmation.
    if (action === "accept_google" || isHoursField(change.field)) {
      setConfirming({ change, action })
      return
    }
    runDecision(change, action)
  }

  const emptyText =
    protectedCount === 0
      ? "Nothing is protected. Choose fields to protect."
      : lastCheckedAt
        ? null
        : canDecide
          ? "Not checked with Google yet. Use Check Google now, at the top of this tab, to compare."
          : "Not checked with Google yet. An owner or admin can check now."

  return (
    // The settings group below is the labelled section; this only groups it
    // with its summary, settings and history.
    <div data-slot="google-changes" className="flex flex-col gap-3">
      <SettingsGroup
        headingId="google-changes-heading"
        headingAs="h2"
        label={
          <span ref={headingRef} tabIndex={-1} className="outline-none">
            Protected fields Google changed
            {openCount > 0 ? (
              <span className="font-normal tabular-nums">
                {" "}
                · {openCount} to decide
              </span>
            ) : null}
          </span>
        }
        caption="Protected fields where Google now shows something different from ours. Nothing is put back automatically."
        card
        bodyAs={live.length === 0 ? "div" : "ul"}
        className="mt-0"
      >
        {live.length === 0 ? (
          <p className="py-3 text-ui text-ink-muted desk:px-(--np-card-pad)">
            {emptyText ?? (
              <>
                Google matches ours for every protected field.{" "}
                <RelativeTime iso={lastCheckedAt!} prefix="Checked " />.
              </>
            )}
          </p>
        ) : (
          live.map((change) => {
            const failure = failures[change.id]
            const reverting = change.status === "reverting"
            const state = reverting ? revertState(change, now) : null
            const revert = change.revert
            const changeSet =
              revert?.kind === "change_set" ? revert.changeSet : null
            const expired = changeSet
              ? Date.parse(changeSet.expiresAt) <= now
              : false
            const hours = isHoursField(change.field)
            return (
              <ListRow
                key={change.id}
                as="li"
                flush
                wrap
                interactive={false}
                emphasis="neutral"
                wrapperProps={{ "data-slot": "google-change" }}
                wrapperClassName="desk:px-(--np-card-pad)"
                title={fieldTitle(change)}
                subtitle={
                  <span className="flex flex-wrap items-center gap-1.5 pt-1">
                    <StatusPill tone={state?.tone ?? "attention"}>
                      {state?.label ?? GOOGLE_CHANGE_STATUS_LABELS.open}
                    </StatusPill>
                    {change.localEdits ? (
                      <StatusPill tone="neutral">
                        Ours includes unpublished edits
                      </StatusPill>
                    ) : null}
                  </span>
                }
                footerLayout="stack"
                footer={
                  <div className="flex min-w-0 flex-col gap-3 pt-2">
                    <DiffView
                      caption={`${fieldTitle(change)}: ours against Google’s`}
                      fieldLabel={hours ? "When" : "Field"}
                      beforeLabel="Ours"
                      afterLabel="Google’s"
                      rows={changeRows(change)}
                    />
                    <p className="text-caption text-ink-muted">
                      Spotted <RelativeTime iso={change.detectedAt} />
                    </p>
                    {failure ? (
                      <div
                        role="alert"
                        className="flex flex-wrap items-center gap-2 text-ui"
                      >
                        <StatusPill tone="at-risk">
                          Didn’t go through
                        </StatusPill>
                        <span className="min-w-0 grow basis-64 text-ink">
                          {failure}
                        </span>
                      </div>
                    ) : null}
                    {state ? (
                      <div className="flex flex-col gap-2">
                        <p className="text-ui text-ink-secondary">
                          {state.detail}
                        </p>
                        {changeSet && !expired && !changeSet.approvedBy ? (
                          <div className="flex flex-col gap-1">
                            <div>
                              <Button
                                variant="secondary"
                                disabled={busy}
                                disabledReason={
                                  gateReason ??
                                  (changeSet.canApprove
                                    ? undefined
                                    : "A different owner or admin must approve this.")
                                }
                                pending={
                                  approve.isPending &&
                                  approve.variables?.id === changeSet.id
                                }
                                pendingLabel="Approving…"
                                onClick={() =>
                                  approve.mutate(changeSet, {
                                    onSuccess: () => {
                                      clearFailure(change)
                                      toasts.add({
                                        title: "Approved",
                                        description:
                                          "Publish it to put ours back on Google.",
                                        type: "success",
                                      })
                                    },
                                    onError: (error) => fail(change, error),
                                  })
                                }
                              >
                                <CheckIcon aria-hidden />
                                Approve
                              </Button>
                            </div>
                            {!changeSet.canApprove && !gateReason ? (
                              <p className="text-caption text-ink-muted">
                                Someone else must approve: you prepared this
                                change.
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                        {changeSet &&
                        !expired &&
                        changeSet.approvedBy &&
                        revert?.kind === "change_set" &&
                        !revert.dispatched ? (
                          <div>
                            <Button
                              disabled={busy}
                              disabledReason={gateReason}
                              pending={
                                publish.isPending &&
                                publish.variables?.id === changeSet.id
                              }
                              pendingLabel="Publishing…"
                              onClick={() =>
                                publish.mutate(changeSet, {
                                  onSuccess: () => {
                                    clearFailure(change)
                                    toasts.add({
                                      title: "Sent to Google",
                                      description:
                                        "This row updates after the next check with Google.",
                                      type: "success",
                                    })
                                    settled()
                                  },
                                  onError: (error) => fail(change, error),
                                })
                              }
                            >
                              <Undo2Icon aria-hidden />
                              Publish to Google
                            </Button>
                          </div>
                        ) : null}
                        {revert?.kind === "change_request" &&
                        revert.outcome === "awaiting_approval" ? (
                          <div>
                            <Link
                              href={listingHref(locationId, "hours")}
                              className={cn(
                                buttonVariants({ variant: "secondary" })
                              )}
                            >
                              Open the hours editor
                            </Link>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="secondary"
                            disabled={busy}
                            disabledReason={gateReason}
                            pending={
                              decide.isPending &&
                              decide.variables?.changeId === change.id &&
                              decide.variables.action === "put_ours_back"
                            }
                            pendingLabel={
                              hours
                                ? "Putting ours back…"
                                : "Preparing for review…"
                            }
                            onClick={() =>
                              startDecision(change, "put_ours_back")
                            }
                          >
                            <Undo2Icon aria-hidden />
                            Put ours back
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busy}
                            disabledReason={gateReason}
                            pending={
                              decide.isPending &&
                              decide.variables?.changeId === change.id &&
                              decide.variables.action === "accept_google"
                            }
                            pendingLabel="Keeping Google’s…"
                            onClick={() =>
                              startDecision(change, "accept_google")
                            }
                          >
                            Keep Google’s
                          </Button>
                        </div>
                        <p className="text-caption text-ink-muted">
                          {hours
                            ? "Hours may go to Google straight away, or wait for a second approval."
                            : "Put ours back prepares a review to approve and publish."}
                        </p>
                      </div>
                    )}
                  </div>
                }
              />
            )
          })
        )}
      </SettingsGroup>

      {gateReason && live.length > 0 ? (
        <p className="text-ui text-ink-secondary">
          {editReason ?? `${DECIDE_REASON} You can see what changed.`}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="min-w-0 grow basis-48 text-caption text-ink-muted">
          {watchSummary(settings.data) ?? " "}
        </p>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={showSettings}
          aria-controls={settingsId}
          onClick={() => setShowSettings((open) => !open)}
        >
          {showSettings ? "Hide protected fields" : "Choose protected fields"}
        </Button>
      </div>
      {showSettings ? (
        <div id={settingsId}>
          <GoogleWatchSettings locationId={locationId} />
        </div>
      ) : null}

      {history.length > 0 ? (
        <details className="text-ui">
          <summary className="w-fit cursor-pointer rounded-(--np-radius-tag) text-ink-secondary focus-halo pointer-coarse:flex pointer-coarse:min-h-(--np-touch) pointer-coarse:items-center">
            {past.length > HISTORY_SHOWN
              ? `Last ${HISTORY_SHOWN} changes on Google`
              : `Earlier changes on Google (${history.length})`}
          </summary>
          <ul className="mt-2 flex flex-col divide-y divide-line-subtle">
            {history.map((change) => (
              <li
                key={change.id}
                className="flex flex-wrap items-baseline gap-x-2 py-2"
              >
                <span className="text-ink">{fieldTitle(change)}</span>
                <span className="text-ink-muted">· {historyLabel(change)}</span>
                <span className="text-caption text-ink-muted">
                  · {formatDay(change.detectedAt)}
                  {change.decidedBy ? ` · ${change.decidedBy}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <OverwriteConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
        title={
          confirming?.action === "accept_google"
            ? `Keep Google’s ${confirming ? lowerLabel(confirming.change) : ""}?`
            : "Put our hours back on Google?"
        }
        description={
          confirming?.action === "accept_google"
            ? "Google’s value becomes our saved value. Nothing is sent to Google."
            : `This sends our saved hours for ${confirming ? (changeScope(confirming.change) ?? "these days") : ""} to Google, replacing what Google shows. If your organisation needs a second approval, it waits for one first.`
        }
        confirmLabel={
          confirming?.action === "accept_google"
            ? "Keep Google’s"
            : "Put ours back"
        }
        requireAcknowledgement={Boolean(
          confirming?.action === "accept_google" && confirming.change.localEdits
        )}
        acknowledgementLabel="I understand our unpublished edits to this field are replaced."
        pending={decide.isPending}
        pendingLabel={
          confirming?.action === "accept_google"
            ? "Keeping Google’s…"
            : "Putting ours back…"
        }
        onConfirm={() => {
          if (confirming) runDecision(confirming.change, confirming.action)
        }}
      />
    </div>
  )
}
