"use client"

import { useQueryClient } from "@tanstack/react-query"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { ApiClientError } from "@/lib/api/client"
import { generateOrSaveDraft } from "@/lib/api/drafts"
import { publishReview } from "@/lib/api/publish"
import type { ReviewRow } from "@/lib/contracts/reviews"
import { ratingOnlyReply } from "@/lib/domain/rating-only"
import { describeActionError } from "@/lib/errors/action-errors"
import {
  partitionForTemplate,
  runPool,
  stopsBatch,
  TEMPLATE_SKIP_COPY,
  templateBand,
  type TemplateBand,
} from "@/lib/inbox/template-batch"
import { queryKeys } from "@/lib/queries/keys"

type Phase = "setup" | "drafting" | "review" | "publishing" | "done"

type Outcome = {
  draftId?: string
  /** The draft passed its checks and may be published. */
  ready?: boolean
  sent?: "published" | "submitted"
  problem?: string
}

// Drafts run the semantic check (a model call) each; publishes are Google
// writes. Both stay a few at a time so a batch never looks like a burst.
const DRAFT_CONCURRENCY = 3
const PUBLISH_CONCURRENCY = 2

const BAND_LABEL: Record<TemplateBand, string> = {
  positive: "4–5 stars",
  neutral: "3 stars",
  negative: "1–2 stars",
}

function reviewerName(row: ReviewRow): string {
  return row.reviewer.isAnonymous
    ? "Anonymous"
    : (row.reviewer.displayName ?? "Anonymous")
}

/**
 * Reply to a selection of rating-only reviews from the standard template, in
 * two confirmed steps: create and check the drafts, then publish them (or
 * submit them for approval). See lib/inbox/template-batch.ts for why this is
 * the single-reply path run a few at a time, not a new way to publish.
 */
function TemplateReplyDialog({
  open,
  onOpenChange,
  rows,
  onFinished,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The selected rows; ineligible ones are listed and left alone. */
  rows: ReviewRow[]
  /** Called with the ids that were sent, so the selection can drop them. */
  onFinished: (sentIds: string[]) => void
}) {
  const queryClient = useQueryClient()
  const [phase, setPhase] = React.useState<Phase>("setup")
  const [includeLowRatings, setIncludeLowRatings] = React.useState(false)
  const [outcomes, setOutcomes] = React.useState<Record<string, Outcome>>({})
  const [done, setDone] = React.useState(0)
  const [halted, setHalted] = React.useState<string | null>(null)
  const stopRef = React.useRef(false)
  // Mirrors stopRef for rendering; the pool reads the ref between calls.
  const [stopping, setStopping] = React.useState(false)
  // The rows the batch was started with. The list refetches underneath as
  // drafts land, and a row that leaves the current queue must not leave the
  // batch.
  const [batch, setBatch] = React.useState<ReviewRow[]>([])

  const { eligible, skipped } = partitionForTemplate(rows, {
    includeLowRatings,
  })
  const running = phase === "drafting" || phase === "publishing"

  const record = (id: string, patch: Outcome) =>
    setOutcomes((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }))

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.reviewsAll })
    void queryClient.invalidateQueries({ queryKey: queryKeys.reviewCountsAll })
    void queryClient.invalidateQueries({ queryKey: queryKeys.clientsAll })
  }

  const fail = (id: string, error: unknown) => {
    record(id, { problem: describeActionError(error) })
    if (error instanceof ApiClientError && stopsBatch(error)) {
      stopRef.current = true
      setHalted(describeActionError(error))
    }
  }

  const createDrafts = async () => {
    const targets = eligible
    setBatch(targets)
    setOutcomes({})
    setDone(0)
    setHalted(null)
    stopRef.current = false
    setStopping(false)
    setPhase("drafting")
    await runPool(
      targets,
      async (row) => {
        try {
          // No body and no text: the draft route picks the rating template
          // for this review's rating and language, then verifies it.
          const result = await generateOrSaveDraft(row.id, {})
          const verdict = result.verification.verdict
          record(row.id, {
            draftId: result.draftId,
            ready: verdict === "pass" || verdict === "warn",
            problem:
              verdict === "pass" || verdict === "warn"
                ? undefined
                : verdict === "fail"
                  ? "The draft didn't pass its checks. Open it to see why."
                  : "The checks couldn't finish. Open it to run them again.",
          })
        } catch (error) {
          fail(row.id, error)
        } finally {
          setDone((count) => count + 1)
        }
      },
      { concurrency: DRAFT_CONCURRENCY, shouldStop: () => stopRef.current }
    )
    refresh()
    setPhase("review")
  }

  const readyRows = batch.filter((row) => outcomes[row.id]?.ready)

  const publishDrafts = async () => {
    const targets = readyRows
    setDone(0)
    setHalted(null)
    stopRef.current = false
    setStopping(false)
    setPhase("publishing")
    await runPool(
      targets,
      async (row) => {
        const draftId = outcomes[row.id]?.draftId
        if (!draftId) return
        try {
          const result = await publishReview(row.id, {
            draftId,
            expectedReviewUpdateTime: row.updateTime,
          })
          record(row.id, {
            sent:
              result.status === "awaiting_approval" ? "submitted" : "published",
          })
        } catch (error) {
          fail(row.id, error)
        } finally {
          setDone((count) => count + 1)
        }
      },
      { concurrency: PUBLISH_CONCURRENCY, shouldStop: () => stopRef.current }
    )
    refresh()
    setPhase("done")
  }

  // Everything that was sent leaves the selection; anything that needs a
  // look stays selected so the operator can find it.
  const finish = () => {
    const sentIds = batch
      .filter((row) => outcomes[row.id]?.sent)
      .map((row) => row.id)
    onFinished(sentIds)
    onOpenChange(false)
  }

  const publishers = readyRows.filter((row) => row.capabilities.canPublish)
  const submitters = readyRows.length - publishers.length
  const sendLabel =
    submitters === 0
      ? `Publish ${readyRows.length} to Google`
      : publishers.length === 0
        ? `Submit ${readyRows.length} for approval`
        : `Send ${readyRows.length}`

  const bands = (["positive", "neutral", "negative"] as const)
    .map((band) => ({
      band,
      example: eligible.find((row) => templateBand(row.rating) === band),
    }))
    .filter(
      (entry): entry is { band: TemplateBand; example: ReviewRow } =>
        entry.example !== undefined
    )

  const problems = batch.filter((row) => outcomes[row.id]?.problem)
  const published = batch.filter(
    (row) => outcomes[row.id]?.sent === "published"
  ).length
  const submitted = batch.filter(
    (row) => outcomes[row.id]?.sent === "submitted"
  ).length
  const total = phase === "publishing" ? readyRows.length : batch.length

  return (
    <Dialog
      open={open}
      // A run in progress can't be dismissed by Escape or a stray click; Stop
      // is the way out, and it lets in-flight calls finish.
      onOpenChange={(next) => {
        if (!next && running) return
        if (!next && (phase === "review" || phase === "done")) {
          finish()
          return
        }
        onOpenChange(next)
      }}
    >
      <DialogContent size="wide" showCloseButton={!running}>
        <DialogHeader>
          <DialogTitle>Reply with the rating template</DialogTitle>
          <DialogDescription>
            For reviews with stars and no words. Each reply is checked before it
            can be published, exactly as one you write yourself.
          </DialogDescription>
        </DialogHeader>

        {phase === "setup" ? (
          <div className="flex flex-col gap-4">
            <p className="text-body">
              <strong className="tabular-nums">{eligible.length}</strong> of{" "}
              {`${rows.length} selected ${
                eligible.length === 1 ? "review gets" : "reviews get"
              } a template reply, greeting each reviewer by name in the review’s language where it’s known.`}
            </p>

            {bands.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-caption font-semibold text-ink-muted">
                  What they will say (English shown)
                </h3>
                <ul className="flex flex-col gap-2">
                  {bands.map(({ band, example }) => (
                    <li
                      key={band}
                      className="rounded-(--np-radius-control) border border-line bg-surface-alt p-3"
                    >
                      <p className="text-caption text-ink-muted">
                        {BAND_LABEL[band]} · e.g. to {reviewerName(example)}
                      </p>
                      <p className="mt-1 text-body">
                        {
                          ratingOnlyReply(
                            example.rating,
                            "en",
                            example.reviewer.isAnonymous
                              ? null
                              : example.reviewer.displayName
                          ).reply
                        }
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Checkbox
              checked={includeLowRatings}
              onCheckedChange={(checked) =>
                setIncludeLowRatings(checked === true)
              }
              label="Include 1–2 star ratings"
              description="Off by default: a low rating usually deserves a personal reply."
            />

            {skipped.length > 0 ? (
              <details className="text-caption">
                <summary className="cursor-pointer text-ink-muted">
                  {skipped.length} selected{" "}
                  {skipped.length === 1 ? "is" : "are"} left out
                </summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {skipped.map(({ row, reason }) => (
                    <li key={row.id}>
                      <span className="font-semibold">{reviewerName(row)}</span>{" "}
                      · {row.location.name}: {TEMPLATE_SKIP_COPY[reason]}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}

        {running ? (
          <div className="flex flex-col gap-2" aria-live="polite">
            <p className="text-body">
              {phase === "drafting"
                ? "Creating and checking drafts"
                : "Sending"}{" "}
              <span className="tabular-nums">
                {done} of {total}
              </span>
              {stopping ? " · stopping after the ones under way" : ""}
            </p>
            <Progress
              value={done}
              max={Math.max(total, 1)}
              label={
                phase === "drafting" ? "Draft progress" : "Publish progress"
              }
            />
          </div>
        ) : null}

        {phase === "review" ? (
          <p className="text-body" role="status">
            <strong className="tabular-nums">{readyRows.length}</strong>{" "}
            {readyRows.length === 1 ? "draft is" : "drafts are"} checked and
            ready.{" "}
            {submitters > 0 && publishers.length > 0
              ? `${publishers.length} will be published and ${submitters} submitted for approval, because you can't publish for every venue in this selection.`
              : submitters > 0
                ? "They go for approval before anything reaches Google."
                : "Publishing sends them to Google straight away, under each business's name."}{" "}
            You can also stop here: the drafts stay in the inbox as Ready to
            publish.
          </p>
        ) : null}

        {phase === "done" ? (
          <p className="text-body" role="status">
            {published > 0 ? `${published} sent to Google. ` : ""}
            {submitted > 0 ? `${submitted} submitted for approval. ` : ""}
            {published + submitted === 0 ? "Nothing was sent. " : ""}
            {problems.length > 0
              ? `${problems.length} need${problems.length === 1 ? "s" : ""} a look and stay${problems.length === 1 ? "s" : ""} selected.`
              : ""}
          </p>
        ) : null}

        {halted ? (
          <p className="text-body text-danger-ink" role="alert">
            Stopped: {halted}
          </p>
        ) : null}

        {(phase === "review" || phase === "done") && problems.length > 0 ? (
          <ul className="flex flex-col gap-1 text-caption">
            {problems.map((row) => (
              <li key={row.id}>
                <span className="font-semibold">{reviewerName(row)}</span> ·{" "}
                {row.location.name}: {outcomes[row.id]?.problem}
              </li>
            ))}
          </ul>
        ) : null}

        <DialogFooter>
          {phase === "setup" ? (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={eligible.length === 0}
                disabledReason={
                  eligible.length === 0
                    ? "None of the selected reviews can take a template reply."
                    : undefined
                }
                onClick={() => void createDrafts()}
              >
                Create {eligible.length}{" "}
                {eligible.length === 1 ? "draft" : "drafts"}
              </Button>
            </>
          ) : null}
          {running ? (
            <Button
              variant="secondary"
              disabled={stopping}
              onClick={() => {
                stopRef.current = true
                setStopping(true)
                setHalted("you stopped the batch.")
              }}
            >
              Stop
            </Button>
          ) : null}
          {phase === "review" ? (
            <>
              <Button variant="secondary" onClick={finish}>
                Leave as drafts
              </Button>
              <Button
                disabled={readyRows.length === 0}
                disabledReason={
                  readyRows.length === 0
                    ? "No draft passed its checks."
                    : undefined
                }
                onClick={() => void publishDrafts()}
              >
                {sendLabel}
              </Button>
            </>
          ) : null}
          {phase === "done" ? <Button onClick={finish}>Done</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { TemplateReplyDialog }
