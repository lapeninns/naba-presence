"use client"

import { useEffect, useMemo, useState } from "react"
import { GateNote } from "@/components/locations/publish-gate"
import type { IndustryState } from "@/lib/api/location-industry"
import { buildLodgingProposal, sameLodgingFields } from "@/lib/locations/forms/lodging-draft"
import { DraftNotices } from "@/components/editors/draft-notices"
import { useEditorDraft } from "@/lib/editors/use-editor-draft"
import { LodgingEditor } from "./lodging-editor"
import { LodgingReview } from "./lodging-review"
import { LodgingSuggestions } from "./lodging-suggestions"
import { useLodgingWorkspace } from "./lodging-workspace"

export function CompleteLodgingSection({ locationId, loaded, suggested, suggestedError, disabled, publishReason, googleHash, savedReviews }: {
  readonly locationId: string; readonly loaded: Record<string, unknown>; readonly suggested: unknown
  readonly suggestedError: string | null; readonly disabled: boolean; readonly publishReason: string | null
  readonly googleHash?: string; readonly savedReviews: NonNullable<IndustryState["lodgingChangeSets"]>
}) {
  // The revision is Google's lodging hash, or the content itself when there
  // is none: a refetch that returns the same lodging is not a new version,
  // and one that returns different lodging never overwrites unsaved edits
  // (DraftNotices offers "Load theirs" / "Keep mine"). Drafts compare by the
  // editable lodging fields only, the way the review footer does: key order,
  // an emptied group and Google's own metadata (the `updateTime` a confirmed
  // publish moves) are not edits.
  const editor = useEditorDraft({
    initial: loaded,
    revision: googleHash ?? JSON.stringify(loaded),
    scope: { resource: "location-lodging", resourceId: locationId, schemaVersion: 1 },
    parseStashed: plainRecord,
    isEqual: sameLodgingFields,
  })
  const { draft, setDraft, discard } = editor
  const [locked, setLocked] = useState(false)
  const workspace = useLodgingWorkspace(), unavailable = disabled || locked || Boolean(workspace?.busy || workspace?.unresolved)
  const proposal = useMemo(() => buildLodgingProposal(loaded, draft), [loaded, draft])
  const reportDraft = workspace?.reportDraft
  const preview = workspace?.preview
  const blocked = unavailable ? "Check the active lodging request before another write." : publishReason ?? (!proposal.valid ? "Correct the highlighted lodging details before preparing a review." : !googleHash ? "Read the lodging baseline before preparing a review." : null)
  useEffect(() => {
    reportDraft?.({ dirty: proposal.updateMask.length > 0, blocked }, {
      review: () => { if (!blocked && googleHash) preview?.(proposal.payload, proposal.updateMask, googleHash) },
      discard,
    })
  }, [reportDraft, preview, proposal, blocked, googleHash, discard])
  useEffect(() => () => reportDraft?.({ dirty: false, blocked: null }, null), [reportDraft])
  return <div className="flex min-w-0 flex-col gap-5">
    <DraftNotices drafts={[editor]} noun="these lodging details" />
    <LodgingSuggestions value={draft} response={suggested} error={suggestedError} disabled={unavailable} onChange={setDraft} />
    <LodgingEditor value={draft} baseline={loaded} disabled={unavailable} errors={proposal.fieldErrors} onChange={setDraft} />
    {!proposal.valid ? <p role="alert" className="text-ui text-danger-ink">Correct the highlighted lodging details before preparing a review. Unsupported values in a changed list must be reviewed in Google.</p> : null}
    <LodgingReview locationId={locationId} payload={proposal.payload} updateMask={proposal.updateMask} googleHash={googleHash} saved={savedReviews} disabled={disabled || Boolean(publishReason)} previewDisabled={!proposal.valid} onLock={setLocked} />
    <GateNote reason={disabled ? null : publishReason} />
  </div>
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}
