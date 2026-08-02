"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import { queryKeys } from "@/lib/queries/keys"
import { useLegalHolds } from "@/lib/queries/use-legal-holds"
import { createLegalHold, releaseLegalHold, type LegalHold } from "@/lib/api/legal-holds"
import { describeActionError } from "@/lib/settings/action-errors"
import { legalHoldFormSchema } from "@/lib/settings/forms/legal-hold"

export function LegalHoldsCard() {
  const query = useLegalHolds()
  const client = useQueryClient()
  const toast = useToastManager()
  const [reviewId, setReviewId] = useState("")
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  const invalidate = () => client.invalidateQueries({ queryKey: queryKeys.legalHolds })

  const create = useMutation({
    mutationFn: (input: { reviewId: string; reason: string }) => createLegalHold(input),
    onSuccess: async () => {
      setReviewId("")
      setReason("")
      setError(null)
      await invalidate()
      toast.add({ title: "Legal hold applied", type: "success" })
    },
    onError: (mutationError) => toast.add({ title: describeActionError(mutationError), type: "error" }),
  })

  const release = useMutation({
    mutationFn: (id: string) => releaseLegalHold(id),
    onSuccess: async () => {
      await invalidate()
      toast.add({ title: "Legal hold released", type: "success" })
    },
    onError: (mutationError) => toast.add({ title: describeActionError(mutationError), type: "error" }),
  })

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = legalHoldFormSchema.safeParse({ reviewId, reason })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the review and reason.")
      return
    }
    create.mutate(parsed.data)
  }

  const active = query.data?.holds.filter((hold) => !hold.releasedAt) ?? []

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title">Legal holds</h2>
      <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit}>
        <Field error={error ?? undefined} className="min-w-56 flex-1">
          <FieldLabel>Review identifier</FieldLabel>
          <Input value={reviewId} aria-label="Review identifier" onChange={(event) => setReviewId(event.target.value)} />
          <FieldError>{error}</FieldError>
        </Field>
        <Field className="min-w-56 flex-1">
          <FieldLabel>Reason</FieldLabel>
          <Textarea value={reason} aria-label="Hold reason" rows={1} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Applying…" : "Apply hold"}
        </Button>
      </form>

      {query.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : query.isError ? (
        <Empty title="We couldn’t load legal holds" description={describeActionError(query.error)} />
      ) : active.length === 0 ? (
        <Empty title="No active legal holds" description="Holds prevent matching reviews from being erased." />
      ) : (
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead>Review</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {active.map((hold: LegalHold) => (
              <TableRow key={hold.id}>
                <TableCell className="font-medium">{hold.reviewId}</TableCell>
                <TableCell className="text-muted-foreground">{hold.reason}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={release.isPending}
                    aria-label={`Release hold on ${hold.reviewId}`}
                    onClick={() => release.mutate(hold.reviewId)}
                  >
                    Release
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
