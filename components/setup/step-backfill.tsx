"use client"

import { BackfillCard } from "@/components/settings/backfill-card"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { describeActionError } from "@/lib/errors/action-errors"
import { useLocationDirectory } from "@/lib/queries/use-locations"

/**
 * Import past reviews for THIS client's linked listings.
 *
 * The import API takes external location ids, so the step scopes the card to
 * the client's own linked listings: Start never reaches another client's
 * listings, and the table shows only this client's rows. Setup is owner- and
 * admin-only, so the management directory (which carries the external ids)
 * is the one read here.
 *
 * Explicitly not blocking once started: an import over a busy listing takes
 * minutes, and making the operator watch a progress bar before they can
 * invite their team is time spent for nothing. The wizard's Continue reads
 * "Continue while it runs" while it does, and the card keeps reporting
 * progress wherever they go next.
 */
function StepBackfill({
  clientId,
  clientName,
}: {
  clientId: string
  clientName: string
}) {
  const directory = useLocationDirectory("admin")
  const externalLocationIds = (directory.data ?? [])
    .filter((entry) => entry.clientId === clientId && entry.linked)
    .map((entry) => entry.externalLocationId)
    .filter((id): id is string => Boolean(id))

  return (
    <>
      {directory.isPending ? (
        <Skeleton
          aria-busy="true"
          className="h-28 w-full rounded-(--np-radius-card)"
        />
      ) : directory.isError ? (
        // Never fall back to the whole organisation: Start would then import
        // every other client's listings too.
        <Alert variant="destructive">
          <AlertTitle>We couldn’t load {clientName}’s listings</AlertTitle>
          <AlertDescription>
            {describeActionError(directory.error)}
          </AlertDescription>
          <AlertActions>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void directory.refetch()}
            >
              Try again
            </Button>
          </AlertActions>
        </Alert>
      ) : (
        <BackfillCard externalLocationIds={externalLocationIds} />
      )}
      <p className="text-caption text-ink-muted">
        The import keeps going if you move on. {clientName}’s client page shows
        how far it has got.
      </p>
    </>
  )
}

export { StepBackfill }
