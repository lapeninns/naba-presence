"use client"

import { BackfillCard } from "@/components/settings/backfill-card"

/**
 * Import past reviews.
 *
 * Explicitly not blocking once started: an import over a busy listing takes
 * minutes, and making the operator watch a progress bar before they can
 * invite their team is time spent for nothing. The wizard's Continue reads
 * "Continue while it runs" while it does, and the card keeps reporting
 * progress wherever they go next.
 */
function StepBackfill({ clientName }: { clientName: string }) {
  return (
    <>
      <BackfillCard />
      <p className="text-caption text-ink-muted">
        The import keeps going if you move on. {clientName}’s client page shows
        how far it has got.
      </p>
    </>
  )
}

export { StepBackfill }
