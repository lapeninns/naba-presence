"use client"

import { ImportCard } from "@/components/settings/import-card"

/**
 * Link this client's Google listings.
 *
 * The import card already knows how to discover locations, show which are
 * linked and confirm a relink; passing the client makes each link file the
 * listing under it, which is the only difference from importing in Settings.
 */
function StepLocations({
  clientId,
  clientName,
  connectionId,
}: {
  clientId: string
  clientName: string
  /** The login this client's setup attached. */
  connectionId: string | null
}) {
  return (
    <>
      <p className="text-ui text-ink-muted">
        Listings you link here belong to {clientName}. A listing already linked
        to another client keeps its review history when you move it.
      </p>
      <ImportCard clientId={clientId} connectionId={connectionId} />
    </>
  )
}

export { StepLocations }
