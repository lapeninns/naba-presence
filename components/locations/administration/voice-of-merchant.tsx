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

// --- Voice of merchant -----------------------------------------------------
export function VoiceOfMerchantSummary({ data }: { data: RawRecord }) {
  const verified = data.hasVoiceOfMerchant === true
  return (
    <div className="flex items-center gap-2">
      <Badge variant={verified ? "success" : "outline"}>
        {verified ? "Verified" : "Not verified"}
      </Badge>
      <span className="text-caption text-muted-foreground">
        {verified
          ? "Google confirms you speak for this business."
          : "Google has not confirmed you speak for this business yet."}
      </span>
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

  if (paths.length === 0) {
    return (
      <p className="text-caption text-muted-foreground">
        Google has not suggested any changes.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption text-muted-foreground">
        Google suggests {paths.length} change{paths.length === 1 ? "" : "s"} to
        this listing that {paths.length === 1 ? "hasn't" : "haven't"} been
        applied here yet.
      </p>
      <div>
        <Button
          size="sm"
          onClick={() => accept.mutate()}
          disabled={writeBlocked || accept.isPending}
        >
          {accept.isPending ? "Applying…" : "Accept Google's update"}
        </Button>
      </div>
      <SectionGateNote />
    </div>
  )
}
