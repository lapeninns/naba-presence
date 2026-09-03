"use client"

import Link from "next/link"
import * as React from "react"

import { StatusPill } from "@/components/ui/status-pill"
import { healthLabel, healthTone } from "@/lib/clients/health"
import { useClients, useOrgHealth } from "@/lib/queries/use-clients"

import { useClientScope } from "./client-context"

/**
 * Connection health for whatever the page is about.
 *
 * Inside a client, that client's health. Elsewhere, a count: "2 clients need
 * attention" sends an agency somewhere, where a single worst-case word does
 * not. The previous chip collapsed every connection in the organisation to
 * connected or disconnected, which meant one client's broken login was
 * invisible while another client's login still worked.
 */
function ContextHealthChip() {
  const clientId = useClientScope()
  const clients = useClients()
  const org = useOrgHealth()

  const scoped = clientId
    ? clients.data?.items.find((client) => client.id === clientId)
    : undefined

  const tone = scoped ? healthTone(scoped.health) : org.tone
  const label = scoped ? healthLabel(scoped.health) : org.label
  const isPending = clients.isPending

  return (
    <>
      <HealthAnnouncer label={isPending ? null : label} />
      {isPending ? null : (
        <Link
          href={clientId ? `/clients/${clientId}` : "/clients"}
          className="rounded-(--np-radius-pill) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          <StatusPill tone={tone}>
            {/* One element, not a visible copy plus a screen-reader copy:
                two nodes carrying the same accessible text make the chip
                ambiguous to "next item" navigation and to getByText. Below
                `sm` the dot alone shows and the label stays in the
                accessibility tree. */}
            <span className="sr-only sm:not-sr-only">{label}</span>
          </StatusPill>
        </Link>
      )}
    </>
  )
}

/**
 * Announces a CHANGE in health, never the first value a mount observes.
 * Speaking the status on every page load is noise; speaking it when a client's
 * Google connection drops is the point. The wording differs from the visible
 * chip so the two never collide as duplicate accessible text.
 */
function HealthAnnouncer({ label }: { label: string | null }) {
  const [announcement, setAnnouncement] = React.useState("")
  const previous = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (label === null) return
    if (previous.current !== null && previous.current !== label) {
      setAnnouncement(`Connection status: ${label}`)
    }
    previous.current = label
  }, [label])

  return (
    <div aria-live="polite" className="sr-only">
      {announcement}
    </div>
  )
}

export { ContextHealthChip }
