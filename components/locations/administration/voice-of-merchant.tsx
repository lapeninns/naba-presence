"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { runAdministrationOperation } from "@/lib/api/location-administration"
import {
  asRecord,
  asStringArray,
  type RawRecord,
} from "@/lib/locations/google-values"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

import { SectionGateNote, useAdministrationSection } from "./context"

// Both summaries render as rows of the "How Google sees this listing" group:
// the tab shell stacks them in one white surface with a hairline between.

// --- Voice of merchant -----------------------------------------------------
export function VoiceOfMerchantSummary({ data }: { data: RawRecord }) {
  const verified = data.hasVoiceOfMerchant === true
  return (
    <div className="flex min-h-(--np-row-h) items-center justify-between gap-3 px-(--np-card-pad) py-2">
      <div className="flex min-w-0 flex-col">
        <span className="text-body text-ink">Verification status</span>
        <span className="text-caption text-ink-muted">
          {verified
            ? "Google confirms you speak for this business."
            : "Google has not confirmed you speak for this business yet."}
        </span>
      </div>
      <Badge variant={verified ? "success" : "secondary"}>
        {verified ? "Verified" : "Not verified"}
      </Badge>
    </div>
  )
}

// --- Google's suggested update ---------------------------------------------
export function GoogleUpdateSummary({ data }: { data: RawRecord }) {
  const { locationId, writeBlocked } = useAdministrationSection()
  const location = asRecord(data.location)
  const paths = asStringArray(asRecord(data.diffMask).paths)

  const accept = useResourceMutation({
    mutationFn: () =>
      runAdministrationOperation(locationId, {
        operation: "accept_google_update",
        payload: { updateMask: paths, location },
      }),
    invalidate: [queryKeys.locationAdministration(locationId)],
    successToast: "Google's suggested update accepted",
  })

  return (
    <div className="flex min-h-(--np-row-h) flex-col justify-center gap-2 px-(--np-card-pad) py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-body text-ink">Suggested changes</span>
          <span className="text-caption text-ink-muted">
            {paths.length === 0
              ? "Google has not suggested any changes."
              : `Google suggests ${paths.length} change${paths.length === 1 ? "" : "s"} to this listing that ${paths.length === 1 ? "hasn't" : "haven't"} been applied here yet.`}
          </span>
        </div>
        {paths.length > 0 ? (
          <Button
            size="sm"
            variant="tinted"
            onClick={() => accept.mutate()}
            disabled={writeBlocked || accept.isPending}
          >
            {accept.isPending ? "Applying…" : "Accept Google's update"}
          </Button>
        ) : null}
      </div>
      {paths.length > 0 ? <SectionGateNote /> : null}
    </div>
  )
}
