"use client"

import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { RelativeTime } from "@/components/ui/relative-time"
import {
  resolveMediaCreate,
  type MediaResolution,
  type MediaUnresolvedCreate,
} from "@/lib/api/location-media"
import { humaniseCategory } from "@/lib/locations/media-labels"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

/**
 * Creates Google never confirmed and that no photo on the listing accounts
 * for (lib/server/media.ts, "needs_resolution"). Adding the same photo again
 * is refused until someone checks Google and records what they found, so a
 * lost answer can never put the photo on the listing twice.
 *
 * One verdict is sent at a time: while it is, every button waits and the
 * tapped one says it is saving. Someone who cannot publish is told who can
 * record it, rather than asked to do what they have no buttons for.
 */
export function UnresolvedCreates({
  locationId,
  creates,
  canResolve,
  onResolved,
}: {
  locationId: string
  creates: readonly MediaUnresolvedCreate[]
  canResolve: boolean
  onResolved: () => void
}) {
  const resolve = useResourceMutation<
    unknown,
    { attemptId: string; resolution: MediaResolution }
  >({
    mutationFn: ({ attemptId, resolution }) =>
      resolveMediaCreate(locationId, attemptId, resolution),
    successToast: (_data, { resolution }) =>
      resolution === "adopted"
        ? "Marked as added on Google"
        : "Marked as not added. You can add it again.",
    invalidate: [queryKeys.locationMediaAll(locationId)],
    onSuccess: () => onResolved(),
  })

  if (creates.length === 0) return null
  const saving = (attemptId: string, resolution: MediaResolution) =>
    resolve.isPending &&
    resolve.variables?.attemptId === attemptId &&
    resolve.variables.resolution === resolution
  return (
    <div className="flex flex-col gap-2">
      {creates.map((create) => {
        return (
          <Alert key={create.attemptId} variant="warning">
            <AlertTitle>Google did not confirm an upload</AlertTitle>
            <AlertDescription>
              {describeCreate(create)} was sent{" "}
              <RelativeTime iso={create.startedAt} />, but Google did not say
              whether it was added and it is not among the listing’s photos yet.{" "}
              {canResolve
                ? "Check the listing on Google, then record what you find."
                : "Someone who can publish to Google needs to check the listing and record what they find."}{" "}
              Adding it again is blocked until then.
            </AlertDescription>
            {canResolve ? (
              <AlertActions>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    resolve.isPending && !saving(create.attemptId, "adopted")
                  }
                  pending={saving(create.attemptId, "adopted")}
                  pendingLabel="Saving…"
                  onClick={() =>
                    resolve.mutate({
                      attemptId: create.attemptId,
                      resolution: "adopted",
                    })
                  }
                >
                  It is on Google
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    resolve.isPending && !saving(create.attemptId, "abandoned")
                  }
                  pending={saving(create.attemptId, "abandoned")}
                  pendingLabel="Saving…"
                  onClick={() =>
                    resolve.mutate({
                      attemptId: create.attemptId,
                      resolution: "abandoned",
                    })
                  }
                >
                  It is not on Google
                </Button>
              </AlertActions>
            ) : null}
          </Alert>
        )
      })}
    </div>
  )
}

function describeCreate(create: MediaUnresolvedCreate): string {
  const kind = create.mediaFormat === "VIDEO" ? "video" : "photo"
  const name = create.fileName ? `“${create.fileName}”` : null
  const category = create.category
    ? ` (${humaniseCategory(create.category)})`
    : ""
  return name ? `The ${kind} ${name}${category}` : `A ${kind}${category}`
}
