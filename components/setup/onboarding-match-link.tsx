"use client"

import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { fetchOnboardingAccessibleMatches } from "@/lib/api/google-onboarding-accessible-matches"
import { approveOnboardingMatchLink, fetchOnboardingMatchLinkReview, previewOnboardingMatchLink, submitOnboardingMatchLink } from "@/lib/api/google-onboarding-match-link"
import type { GoogleOnboardingDraft } from "@/lib/contracts/google-onboarding"
import { describeActionError } from "@/lib/errors/action-errors"
import { ApiClientError } from "@/lib/api/client"
import { OnboardingMatchLinkReview } from "./onboarding-match-link-review"

export function OnboardingMatchLink({ draft, disabled, onBusyChange, onDirtyChange, onFinished }: {
  readonly draft: GoogleOnboardingDraft
  readonly disabled: boolean
  readonly onBusyChange: (busy: boolean) => void
  readonly onDirtyChange: (dirty: boolean) => void
  readonly onFinished: () => void
}) {
  const params = useSearchParams()
  const router = useRouter()
  const client = useQueryClient()
  const target = { accountId: draft.accountId, draftId: draft.id }
  const reviewId = params.get("onboardingMatchLinkReview")
  const [discover, setDiscover] = useState(false)
  const [selected, setSelected] = useState("")
  const [localName, setLocalName] = useState(draft.payload.title ?? "")
  const matches = useQuery({
    queryKey: ["onboarding-accessible-matches", draft.accountId, draft.id, draft.revision, draft.matchResult?.checkedAt],
    queryFn: async ({ signal }) => {
      const value = await fetchOnboardingAccessibleMatches({ ...target, expectedRevision: draft.revision, expectedMatchCheckedAt: draft.matchResult?.checkedAt ?? "" }, { signal })
      if (value.draftId !== draft.id || value.revision !== draft.revision || value.payloadHash !== draft.payloadHash || value.matchCheckedAt !== draft.matchResult?.checkedAt) throw new ApiClientError(409, "onboarding_matches_stale", "Restore the saved draft and refresh matching before linking.")
      return value
    },
    enabled: discover && !reviewId && !disabled,
    retry: false, refetchOnWindowFocus: false,
  })
  const reviewKey = ["onboarding-match-link-review", draft.accountId, draft.id, draft.revision, draft.matchResult?.checkedAt, reviewId]
  const review = useQuery({ queryKey: reviewKey, queryFn: ({ signal }) => fetchOnboardingMatchLinkReview(target, reviewId ?? "", { signal }), enabled: Boolean(reviewId), retry: false, refetchOnWindowFocus: false })
  const openReview = (id: string | null) => {
    const next = new URLSearchParams(params.toString())
    next.delete("onboardingReview")
    if (id) next.set("onboardingMatchLinkReview", id)
    else next.delete("onboardingMatchLinkReview")
    router.replace(`/setup?${next}`, { scroll: false })
  }
  const preview = useMutation({ mutationFn: () => previewOnboardingMatchLink(target, { expectedRevision: draft.revision, expectedMatchCheckedAt: draft.matchResult?.checkedAt ?? "", matchName: selected, localName: localName.trim() }), retry: false,
    onSuccess: (value) => { client.setQueryData(["onboarding-match-link-review", draft.accountId, draft.id, draft.revision, draft.matchResult?.checkedAt, value.id], value); openReview(value.id) } })
  const approve = useMutation({ mutationFn: () => {
    if (!review.data) throw new ApiClientError(409, "approval_required", "Restore the exact review before approving.")
    return approveOnboardingMatchLink(target, review.data.id, review.data.reviewHash)
  }, retry: false, onSuccess: (value) => client.setQueryData(reviewKey, value) })
  const link = useMutation({ mutationFn: () => {
    if (!review.data) throw new ApiClientError(409, "approval_required", "Restore the exact review before linking.")
    return submitOnboardingMatchLink(target, review.data.id, review.data.reviewHash)
  }, retry: false, onSuccess: onFinished, onError: onFinished })
  const busy = matches.isFetching || (Boolean(reviewId) && review.isFetching) || preview.isPending || approve.isPending || link.isPending
  const decisionDirty = !reviewId && Boolean(selected || localName !== (draft.payload.title ?? ""))
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false) }, [busy, onBusyChange])
  useEffect(() => { onDirtyChange(decisionDirty); return () => onDirtyChange(false) }, [decisionDirty, onDirtyChange])
  if (!draft.matchResult?.matches.length && !reviewId) return null
  const available = matches.data?.matches.filter((match) => match.status === "accessible") ?? []
  const selectedAccessible = available.some((match) => match.matchName === selected)
  const error = preview.error ?? approve.error ?? link.error
  const descriptions = { not_accessible: "Not found in this selected account. Review ownership options above or choose the correct account.", identity_unconfirmed: "Google has not supplied enough consistent identity evidence to link this match.", ambiguous: "Multiple resources share this identity. Resolve the ambiguity in Google and refresh matching." } as const
  return <section aria-labelledby="existing-match-heading" className="flex min-w-0 flex-col gap-4 border-t border-line pt-4">
    <div className="space-y-1"><h4 id="existing-match-heading" className="text-title font-semibold">Link an existing match</h4>
      <p className="text-ui text-ink-muted">Check which potential matches belong to this Google account, then review the exact local mapping.</p></div>
    {disabled && <p role="status" className="text-ui text-ink-muted">Wait for the current action to finish, or discard the creation decision before reviewing an existing match.</p>}
    {reviewId ? review.isPending ? <p role="status">Restoring existing listing review…</p> : review.isError ? <div role="alert" className="space-y-2">
      <p>{describeActionError(review.error)}</p><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => void review.refetch()}>Retry restoring link review</Button><Button variant="ghost" disabled={busy} onClick={() => openReview(null)}>Start a fresh link review</Button></div>
    </div> : review.data && <OnboardingMatchLinkReview key={`${review.data.id}:${review.data.approvedBy ?? "unapproved"}`} value={review.data} busy={busy || disabled} onApprove={() => approve.mutate()} onLink={() => link.mutate()} onRefresh={() => void review.refetch()} onReset={() => { setSelected(""); preview.reset(); approve.reset(); link.reset(); openReview(null) }} /> : <>
      <Button variant="secondary" className="self-start" disabled={disabled || busy || decisionDirty} pending={matches.isFetching} pendingLabel="Checking account access…" onClick={() => { if (discover) void matches.refetch(); else setDiscover(true) }}>Check accessible matches</Button>
      {discover && matches.isError ? <p role="alert" className="text-ui text-danger-ink">{describeActionError(matches.error)} Access could not be established; this is not evidence that a new listing is needed.</p> : matches.data && !matches.isFetching && <>
        <p className="text-caption text-ink-muted">Account access checked {new Date(matches.data.observedAt).toLocaleString("en-GB")}.</p>
        <ul className="divide-y divide-line rounded-(--np-radius-card) border border-line">{matches.data.matches.map((match) => {
          const source = draft.matchResult?.matches.find((item) => item.name === match.matchName)
          return <li key={match.matchName} className="space-y-2 p-4">
            <p className="text-ui font-semibold break-words">{source?.location.title || match.matchName}</p>
            {match.status === "accessible" ? <>
              <p className="text-ui text-ink-muted">Accessible in this account: {match.location.title || match.location.name}</p>
              <p className="font-mono text-caption break-all text-ink-muted">{match.location.name}</p>
              <Button variant="secondary" disabled={disabled || busy} aria-pressed={selected === match.matchName} onClick={() => { setSelected(match.matchName); preview.reset() }}>{selected === match.matchName ? "Selected for link review" : "Select this existing match"}</Button>
            </> : <p className="text-ui text-ink-muted">{descriptions[match.status]}</p>}
          </li>
        })}</ul>
        {available.length === 0 && <p role="status" className="text-ui">No unambiguous accessible match is available for linking in this account.</p>}
        {selected && <>
          <Field><FieldLabel>Local name for this existing listing</FieldLabel><Input value={localName} maxLength={200} disabled={busy || disabled} onChange={(event) => { setLocalName(event.target.value); preview.reset() }} /><FieldDescription>A distinct local name is required. Existing local listings are never merged automatically.</FieldDescription></Field>
          <Button className="self-start" pending={preview.isPending} pendingLabel="Preparing link review…" disabled={disabled || busy || !selectedAccessible || !localName.trim()} onClick={() => preview.mutate()}>Review existing listing link</Button>
        </>}
      </>}
      {decisionDirty && <Button variant="ghost" className="self-start" disabled={busy} onClick={() => { setSelected(""); setLocalName(draft.payload.title ?? ""); preview.reset() }}>Discard link decision</Button>}
    </>}
    {busy && <p role="status" className="text-caption text-ink-muted">{link.isPending ? "Linking the approved resource…" : approve.isPending ? "Checking and saving approval…" : "Checking the saved mapping…"}</p>}
    {error && <p role="alert" className="text-ui text-danger-ink">{describeActionError(error)}{link.isError && " Restore link status before retrying."}</p>}
  </section>
}
