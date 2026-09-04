"use client"

import { BackfillCard } from "@/components/settings/backfill-card"
import { Button } from "@/components/ui/button"

/**
 * Import past reviews.
 *
 * Explicitly not blocking: an import over a busy listing takes minutes, and
 * making the operator watch a progress bar before they can invite their team
 * is time spent for nothing. The card keeps reporting progress wherever they
 * go next.
 */
function StepBackfill({ onAdvance }: { onAdvance: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <BackfillCard />
      <div>
        <Button variant="outline" onClick={onAdvance}>
          Continue while this runs
        </Button>
      </div>
    </div>
  )
}

export { StepBackfill }
