"use client"

import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  resolveMediaCreate,
  type MediaResolution,
  type MediaUnresolvedCreate,
} from "@/lib/api/location-media"
import { formatRelativeTime } from "@/lib/format"
import { humaniseCategory } from "@/lib/locations/media-labels"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

/**
 * Creates Google never confirmed and that no photo on the listing accounts
 * for (lib/server/media.ts, "needs_resolution"). Adding the same photo again
 * is refused until someone checks Google and records what they found, so a
 * lost answer can never put the photo on the listing twice.
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
  return (
    <div className="flex flex-col gap-2">
      {creates.map((create) => {
        return (
          <Alert key={create.attemptId} variant="warning">
            <AlertTitle>Google did not confirm an upload</AlertTitle>
            <AlertDescription>
              {describeCreate(create)} was sent{" "}
              {/* Relative: the server (the library is streamed into the
                  first HTML) and the hydrating browser may read the clock
                  a minute apart. */}
              <span suppressHydrationWarning>
                {formatRelativeTime(create.startedAt)}
              </span>
              , but Google did not say
              whether it was added and it is not among the listing’s photos yet.
              Check the listing on Google, then record what you find. Adding it
              again is blocked until then.
            </AlertDescription>
            {canResolve ? (
              <AlertActions>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={resolve.isPending}
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
                  disabled={resolve.isPending}
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
