"use client"

import * as React from "react"

import { scopeHealthWords } from "@/lib/clients/scope-words"
import { useClients } from "@/lib/queries/use-clients"
import { useWorkspaceMode } from "@/lib/workspace/mode"

import { useClientScope } from "./client-context"

/**
 * Connection health for whatever the page is about.
 *
 * Inside a client, that client's health. Elsewhere, a count: "2 clients need
 * attention" sends an agency somewhere, where a single worst-case word does
 * not. The previous chip collapsed every connection in the organisation to
 * connected or disconnected, which meant one client's broken login was
 * invisible while another client's login still worked.
 *
 * The separate toolbar chip that showed it is retired (DIRECTION D8): the
 * scope control carries the scope's health in words now
 * (scope-sheet-model.tsx `useScopeControl`). This stays for the live
 * announcer below and the phone More sheet's Connections row (shown when
 * there is no scope to switch).
 */
function useContextHealth() {
  const business = useWorkspaceMode() === "business"
  // A business has no client layer to scope by: the chip reports the whole
  // business and links to Listings.
  const clientId = useClientScope()
  const clients = useClients()

  const scoped =
    clientId && !business
      ? clients.data?.items.find((client) => client.id === clientId)
      : undefined

  // A refetch that fails AFTER an earlier success means the numbers on screen
  // are last known, not current. Saying so is different from saying Google is
  // down: the connection may be fine and it is our own server we cannot
  // reach, and an operator acting on stale counts would double-reply.
  const stale = clients.isError && clients.data !== undefined

  // The same words as the scope control (lib/clients/scope-words.ts), so
  // the More sheet and the announcer never disagree with the sidebar.
  const { tone, words } = scopeHealthWords({
    mode: business ? "business" : "agency",
    client: scoped ?? null,
    healths: clients.data
      ? clients.data.items.map((client) => client.health)
      : null,
    stale,
  })
  const label = words ?? ""
  const href = business
    ? "/listings"
    : clientId
      ? `/clients/${clientId}`
      : "/clients"

  return {
    tone,
    label,
    href,
    /** The scoped client's name, while its health is current. */
    scopedName: scoped && !stale ? scoped.name : null,
    isPending: clients.isPending,
  }
}

/**
 * The health announcer, mounted once by the shell rather than inside a
 * control: the scope controls live in bars that are `display: none` at
 * some widths, and a live region inside one never speaks.
 */
function ShellHealthAnnouncer() {
  const { label, isPending } = useContextHealth()
  return <HealthAnnouncer label={isPending ? null : label} />
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

export { ShellHealthAnnouncer, useContextHealth }
