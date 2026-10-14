"use client"

import { CheckIcon, RefreshCwIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { DiffView } from "@/components/ui/diff-view"
import { ListRow } from "@/components/ui/list-row"
import { SettingsGroup } from "@/components/ui/settings-row"
import { StatusPill } from "@/components/ui/status-pill"
import { useToastManager } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import type { ImportProposal } from "@/lib/api/location-import-review"
import { AMBIGUOUS_LABELS_WARNING } from "@/lib/domain/food-menu-import"
import { describeActionError } from "@/lib/errors/action-errors"
import { queryKeys } from "@/lib/queries/keys"
import { useDecideImportProposal } from "@/lib/queries/use-import-review"
import { useQueryClient } from "@tanstack/react-query"
import { cn } from "@/lib/utils"

const KIND_LABELS: Record<ImportProposal["kind"], string> = {
  field_changed: "Changed on Google",
  item_changed: "Changed on Google",
  item_added_on_google: "Added on Google",
  item_missing_from_google: "Missing on Google",
  section_added_on_google: "Section added on Google",
  section_missing_from_google: "Section missing on Google",
  structure_changed: "Menu structure changed",
}

const FIELD_LABELS: Record<string, string> = {
  name: "Business name",
  description: "Description",
  phone: "Phone",
  address: "Address",
  mapsUrl: "Maps link",
  reviewUrl: "Review link",
  website: "Website",
}

/** A value as one line; empty when there is nothing, so the diff can say "Not set". */
function valueSummary(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "object") {
    const node = value as Record<string, unknown>
    const parts: string[] = []
    if (typeof node.itemLabel === "string") parts.push(node.itemLabel)
    if (typeof node.description === "string" && node.description)
      parts.push(node.description)
    if (node.price && typeof node.price === "object") {
      const price = node.price as Record<string, unknown>
      const units =
        typeof price.units === "string"
          ? price.units
          : String(price.units ?? "")
      const nanos = typeof price.nanos === "number" ? price.nanos : 0
      if (units)
        parts.push(
          `${units}${nanos ? `.${String(Math.round(nanos / 1e7)).padStart(2, "0")}` : ""}`
        )
    }
    if (parts.length) return parts.join(" · ")
    return JSON.stringify(node)
  }
  return String(value)
}

export function isAmbiguous(proposal: ImportProposal): boolean {
  return proposal.warnings.includes(AMBIGUOUS_LABELS_WARNING)
}

/**
 * The names the match ladder could not tell apart, off the row's own summary.
 * Written by buildFoodMenuProposals, so an unexpected shape degrades to the
 * section title rather than to a crash.
 */
function ambiguousLabels(proposal: ImportProposal): string[] {
  const value = proposal.googleValue
  if (!value || typeof value !== "object") return []
  const labels = (value as { itemLabels?: unknown }).itemLabels
  return Array.isArray(labels)
    ? labels.filter((label): label is string => typeof label === "string")
    : []
}

export function proposalTitle(proposal: ImportProposal): string {
  if (proposal.resourceType === "profile") {
    return FIELD_LABELS[proposal.fieldKey ?? ""] ?? proposal.fieldKey ?? "Field"
  }
  if (proposal.kind === "structure_changed") {
    return proposal.sectionLabel ?? "Whole menu"
  }
  if (proposal.itemLabel) {
    return proposal.sectionLabel
      ? `${proposal.sectionLabel} · ${proposal.itemLabel}`
      : proposal.itemLabel
  }
  return proposal.sectionLabel ?? "Menu"
}

/** The diff table's first column: what kind of thing changed, in the customer's words. */
function proposalFieldLabel(proposal: ImportProposal): string {
  if (proposal.resourceType === "profile") return proposalTitle(proposal)
  if (proposal.kind === "structure_changed") return "Menu"
  if (proposal.itemLabel) return "Item"
  return "Section"
}

type Decision = "apply" | "ignore" | "delete_local" | "keep_local"

const DECISION_TOAST: Record<Decision, { title: string; description: string }> =
  {
    apply: {
      title: "Suggestion accepted",
      description:
        "NabaPresence now holds Google’s value. Nothing was sent to Google.",
    },
    ignore: {
      title: "Suggestion ignored",
      description:
        "NabaPresence keeps its value. Publish it to replace Google’s.",
    },
    delete_local: {
      title: "Removed here",
      description:
        "Removed from NabaPresence to match Google. Nothing was sent to Google.",
    },
    keep_local: {
      title: "Kept here",
      description:
        "NabaPresence keeps it. Publish the menu to put it back on Google.",
    },
  }

/**
 * One resource's worth of pending suggestions from Google: a settings group
 * whose label names the resource and its pending count, with a link to the
 * editor on the right, then one list row per decision, its actions in the
 * row's footer. On a phone the group has no card chrome, only hairlines
 * between rows; the desk keeps a bordered card.
 *
 * Each row shows what NabaPresence holds ("Here now") against what Google
 * shows ("On Google"), then Accept / Ignore. Accepting changes the local
 * copy only; nothing is published. A decision that fails stays on its row
 * with the reason and a Retry.
 *
 * The parent owns the query (for counts, loading and errors); this renders
 * the pending proposals it is given.
 */
export function SuggestionList({
  locationId,
  resourceType,
  proposals,
  canonicalRevision,
  editDisabledReason,
  editorHref,
}: {
  locationId: string
  resourceType: "profile" | "food_menus"
  /** Pending proposals only. */
  proposals: ImportProposal[]
  canonicalRevision: string
  editDisabledReason: string | null
  editorHref: string
}) {
  const toasts = useToastManager()
  const queryClient = useQueryClient()
  const decide = useDecideImportProposal(locationId)
  const [confirming, setConfirming] = useState<{
    proposal: ImportProposal
    action: "apply" | "delete_local"
  } | null>(null)
  const [failures, setFailures] = useState<
    Record<string, { action: Decision; message: string }>
  >({})

  const label = resourceType === "profile" ? "Business profile" : "Food menu"
  const headingId = `suggestions-${resourceType}`
  // The page explains the gate once; each button also carries it, so a
  // focused, disabled Accept says why instead of being silently dead.
  const gateReason = editDisabledReason
    ? "Only owners and admins can accept or ignore suggestions."
    : undefined
  const disabled = decide.isPending
  const workingId = decide.isPending ? decide.variables?.proposalId : null

  const run = (
    proposal: ImportProposal,
    action: Decision,
    confirmOverwrite = false
  ) => {
    decide.mutate(
      {
        proposalId: proposal.id,
        action,
        resourceType,
        expectedCanonicalRevision: canonicalRevision,
        confirmOverwriteCanonicalChanges: confirmOverwrite,
      },
      {
        onSuccess: () => {
          setConfirming(null)
          setFailures((current) => {
            const next = { ...current }
            delete next[proposal.id]
            return next
          })
          // The tab badge and the overview read the DB-only summary.
          void queryClient.invalidateQueries({
            queryKey: queryKeys.listingSummary(locationId),
          })
          void queryClient.invalidateQueries({
            queryKey: queryKeys.listingSummaries,
          })
          toasts.add({ ...DECISION_TOAST[action], type: "success" })
        },
        onError: (error) => {
          // The server compares the proposal's own pinned value against the
          // live one, so it can find a divergence the raise-time warning never
          // recorded. Offer the acknowledgement rather than a toast the user
          // cannot act on — the claim is already released back to pending.
          if (
            error instanceof ApiClientError &&
            error.code === "canonical_overwrite_confirmation_required" &&
            (action === "apply" || action === "delete_local")
          ) {
            setConfirming({ proposal, action })
            return
          }
          setConfirming(null)
          const message = describeActionError(error)
          setFailures((current) => ({
            ...current,
            [proposal.id]: { action, message },
          }))
          toasts.add({ title: message, type: "error" })
        },
      }
    )
  }

  const startDecision = (proposal: ImportProposal, action: Decision) => {
    const needsAck =
      (action === "apply" || action === "delete_local") &&
      (proposal.warnings.includes("canonical_also_changed") ||
        proposal.kind === "structure_changed")
    if (needsAck && (action === "apply" || action === "delete_local")) {
      setConfirming({ proposal, action })
      return
    }
    run(proposal, action)
  }

  const openEditor = (
    <Link
      href={editorHref}
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-mr-2")}
    >
      Open {label.toLowerCase()}
    </Link>
  )

  return (
    <>
      <SettingsGroup
        data-slot="suggestion-list"
        headingId={headingId}
        label={
          <>
            {label}{" "}
            <span className="font-normal tabular-nums">
              · {proposals.length} waiting
            </span>
          </>
        }
        actions={openEditor}
        card
        bodyAs={proposals.length === 0 ? "div" : "ul"}
        className="mt-0"
      >
        {proposals.length === 0 ? (
          <p className="py-3 text-ui text-ink-muted desk:px-(--np-card-pad)">
            Nothing waiting here. Changes made on Google appear here for review.
          </p>
        ) : (
          proposals.map((proposal) => {
            const missing =
              proposal.kind === "item_missing_from_google" ||
              proposal.kind === "section_missing_from_google"
            const alsoEditedHere = proposal.warnings.includes(
              "canonical_also_changed"
            )
            const failure = failures[proposal.id]
            const working = workingId === proposal.id
            return (
              <ListRow
                key={proposal.id}
                as="li"
                flush
                wrap
                interactive={false}
                emphasis="neutral"
                wrapperProps={{ "data-slot": "suggestion" }}
                wrapperClassName="desk:px-(--np-card-pad)"
                title={proposalTitle(proposal)}
                subtitle={
                  <span className="flex flex-wrap items-center gap-1.5 pt-1">
                    <StatusPill
                      tone={isAmbiguous(proposal) ? "attention" : "pending"}
                    >
                      {isAmbiguous(proposal)
                        ? "Can't match automatically"
                        : KIND_LABELS[proposal.kind]}
                    </StatusPill>
                    {alsoEditedHere ? (
                      <StatusPill tone="attention">Also edited here</StatusPill>
                    ) : null}
                  </span>
                }
                footerLayout="stack"
                footer={
                  <div className="flex min-w-0 flex-col gap-3 pt-2">
                    {isAmbiguous(proposal) ? (
                      // The two-column Here/Google summary would be meaningless:
                      // the row stands for several items that cannot be told apart.
                      <p className="text-ui text-ink-secondary">
                        {ambiguousLabels(proposal).length
                          ? `${ambiguousLabels(proposal)
                              .map((name) => `“${name}”`)
                              .join(
                                ", "
                              )} appears more than once at the same price, so these items can't be matched one by one. Rename them here or on Google, or accept Google's menu as a whole.`
                          : "Items in this section can't be matched one by one. Rename the duplicates here or on Google, or accept Google's menu as a whole."}
                      </p>
                    ) : (
                      <DiffView
                        caption={`${proposalTitle(proposal)}: what NabaPresence holds against what Google shows`}
                        beforeLabel="Here now"
                        afterLabel="On Google"
                        rows={[
                          {
                            field: proposalFieldLabel(proposal),
                            before: valueSummary(proposal.canonicalValue),
                            after: valueSummary(proposal.googleValue),
                            state: "changed",
                          },
                        ]}
                      />
                    )}
                    {proposal.warnings
                      .filter(
                        (warning) =>
                          warning !== "canonical_also_changed" &&
                          warning !== "no_baseline" &&
                          warning !== AMBIGUOUS_LABELS_WARNING
                      )
                      .map((warning) => (
                        <p
                          key={warning}
                          className="text-caption text-ink-muted"
                        >
                          {warning}
                        </p>
                      ))}
                    {failure ? (
                      <div
                        role="alert"
                        className="flex flex-wrap items-center gap-2 text-ui"
                      >
                        <StatusPill tone="at-risk">Not applied</StatusPill>
                        <span className="min-w-0 grow basis-64 text-ink">
                          {failure.message}
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={disabled}
                          disabledReason={gateReason}
                          onClick={() =>
                            startDecision(proposal, failure.action)
                          }
                        >
                          <RefreshCwIcon aria-hidden />
                          Retry
                        </Button>
                      </div>
                    ) : null}
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {missing ? (
                          <>
                            <Button
                              variant="secondary"
                              disabled={disabled}
                              disabledReason={gateReason}
                              pending={
                                working &&
                                decide.variables?.action === "keep_local"
                              }
                              onClick={() =>
                                startDecision(proposal, "keep_local")
                              }
                            >
                              Keep here
                            </Button>
                            <Button
                              variant="danger-outline"
                              disabled={disabled}
                              disabledReason={gateReason}
                              pending={
                                working &&
                                decide.variables?.action === "delete_local"
                              }
                              onClick={() =>
                                startDecision(proposal, "delete_local")
                              }
                            >
                              Remove here
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="secondary"
                              disabled={disabled}
                              disabledReason={gateReason}
                              pending={
                                working && decide.variables?.action === "apply"
                              }
                              pendingLabel="Accepting…"
                              onClick={() => startDecision(proposal, "apply")}
                            >
                              <CheckIcon aria-hidden />
                              Accept
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={disabled}
                              disabledReason={gateReason}
                              pending={
                                working && decide.variables?.action === "ignore"
                              }
                              pendingLabel="Ignoring…"
                              onClick={() => startDecision(proposal, "ignore")}
                            >
                              Ignore
                            </Button>
                          </>
                        )}
                      </div>
                      <p className="text-caption text-ink-muted">
                        {missing
                          ? "Only changes NabaPresence’s copy."
                          : "Accept takes Google’s value into NabaPresence’s copy. Ignore keeps yours, and the next publish of this area puts yours back on Google over this change."}
                      </p>
                    </div>
                  </div>
                }
              />
            )
          })
        )}
      </SettingsGroup>

      <OverwriteConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
        title={
          confirming?.action === "delete_local"
            ? "Remove this from NabaPresence?"
            : "Overwrite your local change?"
        }
        description={
          confirming?.proposal.kind === "structure_changed"
            ? "This replaces your entire local menu with the menu currently on Google. Nothing is sent to Google."
            : confirming?.action === "delete_local"
              ? "This removes the item here to match Google. Nothing is deleted on Google, and you can add it back later."
              : "This was also edited here since the last sync. Accepting keeps Google's version and replaces yours here. Nothing is sent to Google."
        }
        confirmLabel={
          confirming?.action === "delete_local" ? "Remove here" : "Accept"
        }
        requireAcknowledgement
        acknowledgementLabel="I understand this changes my local data."
        pending={decide.isPending}
        // Both decisions change only NabaPresence's copy; nothing is sent.
        pendingLabel={
          confirming?.action === "delete_local"
            ? "Removing here…"
            : "Accepting…"
        }
        onConfirm={() => {
          if (confirming) run(confirming.proposal, confirming.action, true)
        }}
      />
    </>
  )
}
