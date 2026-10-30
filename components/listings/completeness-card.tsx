"use client"

import { RefreshCwIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { CompletenessSkipDialog } from "@/components/listings/completeness-skip-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  SettingsGroup,
  SettingsGroupAction,
  SettingsRow,
} from "@/components/ui/settings-row"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { useToastManager } from "@/components/ui/toast"
import { describeActionError } from "@/lib/errors/action-errors"
import {
  completenessLabel,
  completenessSummary,
  completenessTone,
  failingChecks,
  type CompletenessCheck,
  type CompletenessStatus,
  type ListingCompleteness,
} from "@/lib/listings/completeness"
import {
  useCompletenessSkipMutations,
  useListingCompleteness,
} from "@/lib/listings/completeness-query"
import { importanceLabel, visibleFix } from "@/lib/listings/completeness-view"
import { formatDay } from "@/lib/settings/roles"
import { cn } from "@/lib/utils"

/** The checks behind "Show every check", in the order they are listed. */
const OTHER_GROUPS: readonly {
  status: CompletenessStatus
  label: string
  caption: string
}[] = [
  {
    status: "unknown",
    label: "Not checked yet",
    caption:
      "Nothing recent enough was read from Google to judge these, so they don’t count for or against the score.",
  },
  {
    status: "skipped",
    label: "Skipped",
    caption: "These don’t count towards the score.",
  },
  {
    status: "pass",
    label: "Done",
    caption: "These checks pass.",
  },
  {
    status: "not_applicable",
    label: "Doesn’t apply right now",
    caption: "Nothing to check for these right now.",
  },
]

const HEADING_ID = "listing-completeness-heading"

/**
 * The card's heading, made focusable: where focus goes when the control it
 * was on leaves the page (a skipped check's row, a counted-again one).
 */
function headingForFocus(): HTMLElement | null {
  const heading = document.getElementById(HEADING_ID)
  if (heading && !heading.hasAttribute("tabindex"))
    heading.setAttribute("tabindex", "-1")
  return heading
}

function focusHeading() {
  headingForFocus()?.focus()
}

function FixLink({
  check,
  canManageConsoles,
  variant = "secondary",
}: {
  check: CompletenessCheck
  canManageConsoles: boolean
  variant?: "secondary" | "ghost"
}) {
  const fix = visibleFix(check, canManageConsoles)
  if (!fix) return null
  // "Add website" already names its check; "Open profile" needs the check.
  const named = fix.label.toLowerCase().includes(check.title.toLowerCase())
  return (
    <Link
      href={fix.href}
      className={cn(buttonVariants({ variant, size: "sm" }))}
      aria-label={named ? undefined : `${fix.label}: ${check.title}`}
    >
      {fix.label}
    </Link>
  )
}

/**
 * How complete the listing looks on Google, from what NabaPresence already
 * holds: the checks that fail, most important first, each with the area that
 * fixes it. Checks with nothing recent to judge from are "not checked yet",
 * never a fail. Owners and admins can skip a check that doesn't apply, with
 * a reason everyone sees. DB-only: nothing here asks Google.
 */
function CompletenessCard({
  locationId,
  linked,
  canManage,
}: {
  locationId: string
  linked: boolean
  /** Owner or admin: may skip checks and open owner-only areas. */
  canManage: boolean
}) {
  const query = useListingCompleteness(locationId)
  const toast = useToastManager()
  const { unskip } = useCompletenessSkipMutations(locationId)
  const [skipping, setSkipping] = useState<CompletenessCheck | null>(null)
  const [showAll, setShowAll] = useState(false)
  const data = query.data ?? null

  const group = (
    children: React.ReactNode,
    options: {
      caption?: React.ReactNode
      busy?: boolean
      action?: React.ReactNode
    } = {}
  ) => (
    <SettingsGroup
      id="listing-completeness"
      label="Completeness"
      caption={options.caption}
      action={options.action}
      card
      className="mt-0"
      aria-busy={options.busy || undefined}
    >
      {children}
    </SettingsGroup>
  )

  if (!linked) {
    return group(
      <SettingsRow
        label="Not linked to Google"
        description="Link this listing to check how complete it is on Google."
        value={
          <StatusPill tone="neutral" plain>
            Not linked
          </StatusPill>
        }
      />
    )
  }

  if (query.isPending) {
    return group(
      <>
        {[0, 1, 2].map((index) => (
          <li key={index} aria-hidden className="py-3">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="mt-2 h-3.5 w-3/4" />
          </li>
        ))}
      </>,
      { busy: true }
    )
  }

  if (!data) {
    return group(
      <SettingsRow
        label="Couldn’t check completeness"
        description={
          query.isError
            ? "We didn’t get an answer just now. Nothing was changed."
            : "This listing isn’t available to you."
        }
        action={
          query.isError ? (
            <Button
              variant="secondary"
              size="sm"
              pending={query.isFetching}
              pendingLabel="Trying again…"
              onClick={() => void query.refetch()}
            >
              <RefreshCwIcon aria-hidden />
              Try again
            </Button>
          ) : undefined
        }
      />
    )
  }

  const failing = failingChecks(data)
  const others = data.checks.length - failing.length
  // The last other check counted again leaves nothing to show or hide.
  if (others === 0 && showAll) setShowAll(false)
  const caption = (
    <>
      <StatusPill tone={completenessTone(data.score)} className="me-2">
        {data.score === null
          ? completenessLabel(null)
          : `${completenessLabel(data.score)} complete`}
      </StatusPill>
      {completenessSummary(data)}
      {!canManage && failing.length > 0
        ? " An owner or admin can skip a check that doesn’t apply."
        : null}
    </>
  )

  const unskipCheck = (check: CompletenessCheck) =>
    unskip.mutate(check.id, {
      onSuccess: () => {
        // Its row moves back to the list above: keep focus in the card.
        focusHeading()
        toast.add({
          title: `“${check.title}” counts towards the score again`,
          type: "success",
        })
      },
      onError: (error) =>
        toast.add({
          title: `Couldn’t count “${check.title}” again`,
          description: describeActionError(error),
          type: "error",
        }),
    })

  return (
    <>
      {group(
        failing.length === 0 ? (
          <SettingsRow
            label="Nothing to fix"
            description={
              data.counts.unknown > 0
                ? "Everything checked so far is in place. Some checks aren’t done yet."
                : "This listing has everything we check for."
            }
            value={
              data.counts.unknown > 0 ? undefined : (
                <StatusPill tone="healthy">Done</StatusPill>
              )
            }
          />
        ) : (
          failing.map((check) => (
            <SettingsRow
              key={check.id}
              label={check.title}
              description={`${importanceLabel(check.importance)} · ${check.detail}`}
              action={
                // Stacked on a phone, so the check's words keep the width.
                <span className="flex flex-col items-end gap-2 desk:flex-row desk:items-center desk:gap-1.5">
                  <FixLink check={check} canManageConsoles={canManage} />
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSkipping(check)}
                      aria-label={`Skip: ${check.title}`}
                    >
                      Skip
                    </Button>
                  ) : null}
                </span>
              }
            />
          ))
        ),
        {
          caption,
          action:
            others > 0 ? (
              <SettingsGroupAction
                aria-expanded={showAll}
                aria-controls="listing-completeness-others"
                onClick={() => setShowAll((open) => !open)}
              >
                {showAll
                  ? "Hide other checks"
                  : `Show other checks (${others})`}
              </SettingsGroupAction>
            ) : undefined,
        }
      )}
      <div
        id="listing-completeness-others"
        hidden={!showAll}
        className="flex flex-col gap-4"
      >
        {showAll ? (
          <OtherChecks
            data={data}
            canManage={canManage}
            onUnskip={unskipCheck}
            unskipping={unskip.isPending ? unskip.variables : undefined}
          />
        ) : null}
      </div>
      <CompletenessSkipDialog
        locationId={locationId}
        check={skipping}
        onOpenChange={(open) => {
          if (!open) setSkipping(null)
        }}
        // A skipped check leaves the list, and its Skip button with it.
        finalFocus={() => headingForFocus() ?? true}
      />
    </>
  )
}

function OtherChecks({
  data,
  canManage,
  onUnskip,
  unskipping,
}: {
  data: ListingCompleteness
  canManage: boolean
  onUnskip: (check: CompletenessCheck) => void
  /** The check id being counted again, while that request runs. */
  unskipping?: string
}) {
  return OTHER_GROUPS.map((other) => {
    const checks = data.checks.filter((check) => check.status === other.status)
    if (checks.length === 0) return null
    return (
      <SettingsGroup
        key={other.status}
        id={`listing-completeness-${other.status}`}
        label={`${other.label} (${checks.length})`}
        caption={other.caption}
        as="h3"
        card
        className="mt-0"
      >
        {checks.map((check) => (
          <SettingsRow
            key={check.id}
            label={check.title}
            description={
              check.skip
                ? `Skipped: “${check.skip.reason}” · ${formatDay(check.skip.skippedAt)}`
                : `${importanceLabel(check.importance)} · ${check.detail}`
            }
            action={
              check.status === "skipped" && canManage ? (
                <Button
                  variant="ghost"
                  size="sm"
                  pending={unskipping === check.id}
                  pendingLabel="Counting again…"
                  onClick={() => onUnskip(check)}
                  aria-label={`Count again: ${check.title}`}
                >
                  Count again
                </Button>
              ) : check.status === "unknown" ? (
                <FixLink
                  check={check}
                  canManageConsoles={canManage}
                  variant="ghost"
                />
              ) : undefined
            }
          />
        ))}
      </SettingsGroup>
    )
  })
}

export { CompletenessCard }
