"use client"

import { useQueryClient } from "@tanstack/react-query"

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
import { queryKeys } from "@/lib/queries/keys"
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
 *
 * Start only refreshes the import's own progress, and the wizard reads its
 * blocker from the setup query, so once Start has its answer the step
 * re-reads setup: the footer clears on the server's word, without a wasted
 * Continue. The "keeps going" note shows only once something is in flight;
 * before that the step description says it.
 */
function StepBackfill({
  clientId,
  clientName,
  business,
}: {
  clientId: string
  clientName: string
  business: boolean
}) {
  const queryClient = useQueryClient()
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
          <AlertTitle>
            {business
              ? "We couldn’t load your listings"
              : `We couldn’t load ${clientName}’s listings`}
          </AlertTitle>
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
        <BackfillCard
          externalLocationIds={externalLocationIds}
          onStartSettled={() =>
            void queryClient.invalidateQueries({
              queryKey: queryKeys.clientSetup(clientId),
            })
          }
          inFlightNote={
            <p className="text-ui text-ink-muted">
              {business
                ? "The import keeps going if you move on. Come back to this step to see how far it has got."
                : `The import keeps going if you move on. ${clientName}’s client page shows whether it is still running.`}
            </p>
          }
        />
      )}
    </>
  )
}

export { StepBackfill }
