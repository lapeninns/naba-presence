"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Lock } from "lucide-react"
import { useId, useState } from "react"

import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { GroupedList, GroupedListItem } from "@/components/ui/grouped-list"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import { queryKeys } from "@/lib/queries/keys"
import { useLegalHolds } from "@/lib/queries/use-legal-holds"
import {
  createLegalHold,
  releaseLegalHold,
  type LegalHold,
} from "@/lib/api/legal-holds"
import { describeActionError } from "@/lib/errors/action-errors"
import { legalHoldFormSchema } from "@/lib/settings/forms/legal-hold"

/**
 * Legal holds: a form to place one, and the list of holds still in force,
 * each with its reason and a Release action.
 */
export function LegalHoldsCard() {
  const query = useLegalHolds()
  const client = useQueryClient()
  const toast = useToastManager()
  const headingId = useId()
  const [reviewId, setReviewId] = useState("")
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  const invalidate = () =>
    client.invalidateQueries({ queryKey: queryKeys.legalHolds })

  const create = useMutation({
    mutationFn: (input: { reviewId: string; reason: string }) =>
      createLegalHold(input),
    onSuccess: async () => {
      setReviewId("")
      setReason("")
      setError(null)
      await invalidate()
      toast.add({ title: "Legal hold applied", type: "success" })
    },
    onError: (mutationError) =>
      toast.add({ title: describeActionError(mutationError), type: "error" }),
  })

  const release = useMutation({
    mutationFn: (id: string) => releaseLegalHold(id),
    onSuccess: async () => {
      await invalidate()
      toast.add({ title: "Legal hold released", type: "success" })
    },
    onError: (mutationError) =>
      toast.add({ title: describeActionError(mutationError), type: "error" }),
  })

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = legalHoldFormSchema.safeParse({ reviewId, reason })
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? "Check the review and reason."
      )
      return
    }
    create.mutate(parsed.data)
  }

  const active = query.data?.holds.filter((hold) => !hold.releasedAt) ?? []

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-title font-semibold text-ink">
          Legal holds
        </h2>
        <p className="text-ui text-ink-muted">
          A hold keeps a review’s records from being erased while it is in
          force.
        </p>
      </div>
      <form
        className="flex flex-col gap-3 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)"
        onSubmit={onSubmit}
      >
        <div className="flex flex-wrap items-start gap-3">
          <Field error={error ?? undefined} className="min-w-56 flex-1">
            <FieldLabel>Review identifier</FieldLabel>
            <Input
              value={reviewId}
              aria-label="Review identifier"
              onChange={(event) => setReviewId(event.target.value)}
            />
            <FieldError>{error}</FieldError>
          </Field>
          <Field className="min-w-56 flex-1">
            <FieldLabel>Reason</FieldLabel>
            <Textarea
              value={reason}
              aria-label="Hold reason"
              rows={1}
              className="min-h-(--np-field-h)"
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Applying…" : "Apply hold"}
          </Button>
        </div>
      </form>

      {query.isPending ? (
        <Skeleton className="h-[calc(var(--np-row-h)*2)] w-full rounded-(--np-radius-card)" />
      ) : query.isError ? (
        <Empty
          title="We couldn’t load legal holds"
          description={describeActionError(query.error)}
        />
      ) : active.length === 0 ? (
        <Empty
          icon={<Lock />}
          title="No active legal holds"
          description="Holds prevent matching reviews from being erased."
        />
      ) : (
        <GroupedList aria-label="Active legal holds">
          {active.map((hold: LegalHold) => (
            <GroupedListItem
              key={hold.id}
              icon={<Lock />}
              label={hold.reviewId}
              description={hold.reason}
              trailing={
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger-ink"
                  disabled={release.isPending}
                  aria-label={`Release hold on ${hold.reviewId}`}
                  onClick={() => release.mutate(hold.reviewId)}
                >
                  Release
                </Button>
              }
            />
          ))}
        </GroupedList>
      )}
    </section>
  )
}
