"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, ShieldCheck } from "lucide-react"
import { useRef, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Empty } from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import { StatusPill } from "@/components/ui/status-pill"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import {
  createLegalHold,
  releaseLegalHold,
  type LegalHold,
} from "@/lib/api/privacy"
import { describeActionError } from "@/lib/errors/action-errors"
import { queryKeys } from "@/lib/queries/keys"
import { useLegalHolds } from "@/lib/queries/use-privacy"
import { legalHoldFormSchema } from "@/lib/settings/forms/legal-hold"
import type { PrivacyGating } from "@/lib/settings/gating"
import { formatDay } from "@/lib/settings/roles"

/** Active holds first, each group newest first. */
function sortHolds(holds: readonly LegalHold[]): LegalHold[] {
  return [...holds].sort((a, b) => {
    const active = Number(a.releasedAt !== null) - Number(b.releasedAt !== null)
    if (active !== 0) return active
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
}

function ApplyHoldDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const client = useQueryClient()
  const toast = useToastManager()
  const reviewRef = useRef<HTMLInputElement>(null)
  const [reviewId, setReviewId] = useState("")
  const [reason, setReason] = useState("")
  const [errors, setErrors] = useState<{
    reviewId?: string
    reason?: string
  }>({})
  const [formError, setFormError] = useState<string | null>(null)

  const reset = () => {
    setReviewId("")
    setReason("")
    setErrors({})
    setFormError(null)
  }

  const apply = useMutation({
    mutationFn: createLegalHold,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.privacyAll })
      toast.add({ title: "Legal hold applied", type: "success" })
      reset()
      onOpenChange(false)
    },
    onError: (error) => setFormError(describeActionError(error)),
  })

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)
    const parsed = legalHoldFormSchema.safeParse({ reviewId, reason })
    if (!parsed.success) {
      const next: { reviewId?: string; reason?: string } = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if ((key === "reviewId" || key === "reason") && !next[key]) {
          next[key] = issue.message
        }
      }
      setErrors(next)
      if (next.reviewId) reviewRef.current?.focus()
      return
    }
    setErrors({})
    apply.mutate(parsed.data)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>Apply a legal hold</DialogTitle>
          <DialogDescription>
            A held review is kept whole: retention does not redact or delete it,
            and an erasure request that matches it is refused until the hold is
            released.
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={onSubmit} className="contents">
          <DialogBody>
            <Field error={errors.reviewId}>
              <FieldLabel>Review identifier</FieldLabel>
              <Input
                ref={reviewRef}
                autoComplete="off"
                className="font-mono"
                value={reviewId}
                placeholder="00000000-0000-0000-0000-000000000000"
                onChange={(event) => {
                  setReviewId(event.target.value)
                  if (errors.reviewId)
                    setErrors((current) => ({
                      ...current,
                      reviewId: undefined,
                    }))
                }}
              />
              <FieldDescription>
                Export the reviewer’s records above: each review in the file
                carries its identifier as <code>id</code>.
              </FieldDescription>
              <FieldError>{errors.reviewId}</FieldError>
            </Field>
            <Field error={errors.reason}>
              <FieldLabel>Reason</FieldLabel>
              <Textarea
                value={reason}
                maxLength={1000}
                onChange={(event) => {
                  setReason(event.target.value)
                  if (errors.reason)
                    setErrors((current) => ({ ...current, reason: undefined }))
                }}
              />
              <FieldError>{errors.reason}</FieldError>
            </Field>
            {formError ? (
              <Alert variant="destructive">
                <AlertTitle>The hold wasn’t applied</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost">Cancel</Button>} />
            <Button
              type="submit"
              pending={apply.isPending}
              pendingLabel="Applying…"
            >
              Apply hold
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Legal holds (plan P04-7): owners apply and release them, admins see them.
 * A hold covers one review; retention and erasure skip it until released.
 */
export function LegalHoldsPanel({ gating }: { gating: PrivacyGating }) {
  const query = useLegalHolds()
  const client = useQueryClient()
  const toast = useToastManager()
  const [applying, setApplying] = useState(false)
  const [releaseTarget, setReleaseTarget] = useState<LegalHold | null>(null)
  const holds = query.data ? sortHolds(query.data.holds) : []

  const release = useMutation({
    mutationFn: (reviewId: string) => releaseLegalHold(reviewId),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.privacyAll })
      toast.add({ title: "Legal hold released", type: "success" })
    },
    onError: (error) =>
      toast.add({ title: describeActionError(error), type: "error" }),
  })

  return (
    <section aria-labelledby="legal-holds" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="legal-holds" className="text-title font-semibold text-ink">
            Legal holds
          </h2>
          <p className="text-caption text-ink-muted">
            Reviews kept out of retention and erasure while a legal matter is
            open.
          </p>
        </div>
        {gating.canManagePrivacy ? (
          <Button variant="secondary" onClick={() => setApplying(true)}>
            <Plus aria-hidden />
            Apply a hold
          </Button>
        ) : null}
      </div>
      <QueryStates
        status={queryStatus(query, { isEmpty: holds.length === 0 })}
        pendingLabel="Loading legal holds"
        error={{ title: "We couldn’t load legal holds", cause: query.error }}
        onRetry={() => void query.refetch()}
        empty={
          <Card flush>
            <Empty
              icon={<ShieldCheck />}
              title="No legal holds"
              description="Nothing is being kept back from retention or erasure."
            />
          </Card>
        }
      >
        {() => (
          <Table surface responsive aria-label="Legal holds">
            <TableHeader>
              <TableRow>
                <TableHead>Review</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {holds.map((hold) => {
                const active = hold.releasedAt === null
                return (
                  <TableRow key={hold.id}>
                    <TableCell label="Review">
                      <span className="font-mono text-caption [overflow-wrap:anywhere]">
                        {hold.reviewId}
                      </span>
                    </TableCell>
                    <TableCell label="Reason">
                      <span className="[overflow-wrap:anywhere]">
                        {hold.reason}
                      </span>
                    </TableCell>
                    <TableCell label="Status">
                      <span className="flex flex-col gap-1">
                        {active ? (
                          <StatusPill tone="attention">Held</StatusPill>
                        ) : (
                          <StatusPill tone="neutral" dashed>
                            Released
                          </StatusPill>
                        )}
                        <span className="text-caption text-ink-muted">
                          {active
                            ? `Since ${formatDay(hold.createdAt)}`
                            : `Released ${formatDay(hold.releasedAt!)}`}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell data-actions="" className="text-right">
                      {active && gating.canManagePrivacy ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={release.isPending}
                          aria-label={`Release hold on review ${hold.reviewId}`}
                          onClick={() => setReleaseTarget(hold)}
                        >
                          Release
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </QueryStates>
      {gating.canManagePrivacy ? (
        <>
          <ApplyHoldDialog open={applying} onOpenChange={setApplying} />
          <AlertDialog
            open={releaseTarget !== null}
            onOpenChange={(open) => {
              if (!open) setReleaseTarget(null)
            }}
          >
            <AlertDialogContent className="grid-cols-[minmax(0,1fr)]">
              <AlertDialogTitle>Release this legal hold?</AlertDialogTitle>
              <AlertDialogDescription>
                The review goes back under the normal retention rules, and the
                next daily retention run may redact or delete it. An erasure
                request that matches it can then be fulfilled.
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogClose
                  render={<Button variant="ghost">Keep the hold</Button>}
                />
                <Button
                  variant="danger"
                  pending={release.isPending}
                  pendingLabel="Releasing…"
                  onClick={() => {
                    if (!releaseTarget) return
                    release.mutate(releaseTarget.reviewId, {
                      onSettled: () => setReleaseTarget(null),
                    })
                  }}
                >
                  Release hold
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </section>
  )
}
