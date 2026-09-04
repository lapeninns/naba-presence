"use client"

import { ImportCard } from "@/components/settings/import-card"

/**
 * Link this client's Google locations.
 *
 * The import card already knows how to discover locations, show which are
 * linked and confirm a relink; passing the client makes each link file the
 * location under it, which is the only difference from importing in Settings.
 */
function StepLocations({
  clientId,
  clientName,
}: {
  clientId: string
  clientName: string
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ui text-ink-muted">
        Locations you link here belong to {clientName}. A location already
        linked to another client keeps its review history when you move it.
      </p>
      <ImportCard clientId={clientId} />
    </div>
  )
}

export { StepLocations }
