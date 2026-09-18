"use client"

import { useState } from "react"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { GateNote } from "@/components/locations/publish-gate"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DiffView, type DiffRow } from "@/components/ui/diff-view"
import { useToastManager } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import type { ImportProposal } from "@/lib/api/location-import-review"
import { AMBIGUOUS_LABELS_WARNING } from "@/lib/domain/food-menu-import"
import { describeActionError } from "@/lib/errors/action-errors"
import {
  useDecideImportProposal,
  useImportReview,
  useRefreshImportReview,
} from "@/lib/queries/use-import-review"

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

function isAmbiguous(proposal: ImportProposal): boolean {
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

function proposalTitle(proposal: ImportProposal): string {
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

/**
 * One resource's worth of pending suggestions from Google.
 *
 * This used to be a card wedged above the fields of two different editors, so
 * an operator arriving to change the opening description first had to get past
 * a queue of unrelated decisions. It now lives on its own segment, and the tab
 * carries the count.
 */
export function SuggestionList({
  locationId,
  resourceType,
  canonicalRevision,
  editDisabledReason,
}: {
  locationId: string
  resourceType: "profile" | "food_menus"
  canonicalRevision: string
  editDisabledReason: string | null
}) {
  const toasts = useToastManager()
  const review = useImportReview(locationId, resourceType)
  const refresh = useRefreshImportReview(locationId)
  const decide = useDecideImportProposal(locationId)
  const [confirming, setConfirming] = useState<{
    proposal: ImportProposal
    action: "apply" | "delete_local"
  } | null>(null)

  if (review.isPending || review.isError) return null
  const { proposals, importReviewEnabled } = review.data
  const pending = proposals.filter((proposal) => proposal.status === "pending")
  if (!importReviewEnabled) return null

  const disabled = Boolean(editDisabledReason) || decide.isPending

  const run = (
    proposal: ImportProposal,
    action: "apply" | "ignore" | "delete_local" | "keep_local",
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
          toasts.add({
            title:
              action === "apply"
                ? "Suggestion accepted"
                : action === "delete_local"
                  ? "Removed here"
                  : "Suggestion dismissed",
            type: "success",
          })
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
          toasts.add({ title: describeActionError(error), type: "error" })
        },
      }
    )
  }

  const startDecision = (
    proposal: ImportProposal,
    action: "apply" | "ignore" | "delete_local" | "keep_local"
  ) => {
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

  return (
    // A panel with a header band and a list body, not a Card: the queue is a
    // list of decisions, and every other list in the console — members,
    // admins, hours, menu sections — is drawn this way. The rows reach the
    // panel's edges so their hairlines run its full width, the way a grouped
    // list divides.
    <section
      aria-labelledby={`suggestions-${resourceType}`}
      // `overflow-hidden`, as every hairline-divided panel here carries: the
      // header band's rule would otherwise run straight through the card's
      // rounded corners.
      className="flex flex-col overflow-hidden rounded-(--np-radius-card) bg-surface"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-subtle px-(--np-card-pad) py-3">
        <h2
          id={`suggestions-${resourceType}`}
          className="text-title font-semibold text-ink"
        >
          {resourceType === "profile" ? "Business profile" : "Food menu"}
        </h2>
        {pending.length > 0 ? (
          <Badge variant="warning">{pending.length}</Badge>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto"
          onClick={() => refresh.mutate(resourceType)}
          disabled={refresh.isPending}
        >
          {refresh.isPending ? "Checking…" : "Refresh from Google"}
        </Button>
      </div>

      <div className="flex flex-col">
        {pending.length === 0 ? (
          <p className="px-(--np-card-pad) py-4 text-caption text-ink-muted">
            No pending suggestions. Changes made on Google appear here for
            review.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-subtle">
            {pending.map((proposal) => {
              const missing =
                proposal.kind === "item_missing_from_google" ||
                proposal.kind === "section_missing_from_google"
              const alsoEditedHere = proposal.warnings.includes(
                "canonical_also_changed"
              )
              const diffRows: DiffRow[] = [
                {
                  field: proposalFieldLabel(proposal),
                  before: valueSummary(proposal.canonicalValue),
                  after: valueSummary(proposal.googleValue),
                  state: alsoEditedHere ? "conflict" : "changed",
                },
              ]
              return (
                <li
                  key={proposal.id}
                  className="flex flex-col gap-3 px-(--np-card-pad) py-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body font-semibold text-ink">
                      {proposalTitle(proposal)}
                    </span>
                    <Badge variant={missing ? "info" : "warning"}>
                      {isAmbiguous(proposal)
                        ? "Can't match automatically"
                        : KIND_LABELS[proposal.kind]}
                    </Badge>
                    {alsoEditedHere ? (
                      <Badge variant="warning">Also edited here</Badge>
                    ) : null}
                  </div>
                  {isAmbiguous(proposal) ? (
                    // The two-column Here/Google summary would be meaningless:
                    // the row stands for several items that cannot be told apart.
                    <p className="text-caption text-ink-muted">
                      {ambiguousLabels(proposal).length
                        ? `${ambiguousLabels(proposal)
                            .map((label) => `“${label}”`)
                            .join(
                              ", "
                            )} appears more than once at the same price, so these items can't be matched one by one. Rename them here or on Google, or accept Google's menu as a whole.`
                        : "Items in this section can't be matched one by one. Rename the duplicates here or on Google, or accept Google's menu as a whole."}
                    </p>
                  ) : (
                    <DiffView
                      className="hairline"
                      caption={`${proposalTitle(proposal)}: what NabaPresence holds against what Google shows`}
                      beforeLabel="Here now"
                      afterLabel="On Google"
                      rows={diffRows}
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
                      <p key={warning} className="text-caption text-ink-muted">
                        {warning}
                      </p>
                    ))}
                  <div className="flex flex-wrap gap-2">
                    {missing ? (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={disabled}
                          onClick={() => startDecision(proposal, "keep_local")}
                        >
                          Keep here
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={disabled}
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
                          size="sm"
                          variant="tinted"
                          disabled={disabled}
                          onClick={() => startDecision(proposal, "apply")}
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={disabled}
                          onClick={() => startDecision(proposal, "ignore")}
                        >
                          Dismiss
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {/* Deliberately not an echo of `editDisabledReason`. That prop
            carries the sentence the host tab already shows beside its own
            Save button, and repeating it verbatim put the identical note
            twice on one screen -- read out twice by a screen reader, for two
            different sets of controls. This one names what these buttons do.
            (`editDisabledReason` is non-null only for the canEditCanonical
            gate, so owners/admins is the accurate reason -- lib/locations/gating.ts.) */}
        {editDisabledReason ? (
          <div className="border-t border-line-subtle px-(--np-card-pad) py-3">
            <GateNote reason="Only owners and admins can accept or dismiss suggestions." />
          </div>
        ) : null}
      </div>

      <OverwriteConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
        title={
          confirming?.action === "delete_local"
            ? "Remove this from NabaPresence?"
            : "Overwrite your local changes?"
        }
        description={
          confirming?.proposal.kind === "structure_changed"
            ? "This replaces your entire local menu with the menu currently on Google."
            : confirming?.action === "delete_local"
              ? "This removes the item here to match Google. You can add it back later."
              : "This was also edited here since the last sync. Accepting keeps Google's version."
        }
        confirmLabel={
          confirming?.action === "delete_local" ? "Remove" : "Accept"
        }
        requireAcknowledgement
        acknowledgementLabel="I understand this changes my local data."
        pending={decide.isPending}
        onConfirm={() => {
          if (confirming) run(confirming.proposal, confirming.action, true)
        }}
      />
    </section>
  )
}
