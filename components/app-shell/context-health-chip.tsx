"use client"

import * as React from "react"

import { healthLabel, healthTone } from "@/lib/clients/health"
import { useClients, useOrgHealth } from "@/lib/queries/use-clients"
import { TONE_CLASSES } from "@/lib/ui/status-tone"
import { useWorkspaceMode } from "@/lib/workspace/mode"
import { cn } from "@/lib/utils"

import { useClientScope } from "./client-context"
import { ShellLink } from "./shell-link"

/**
 * Connection health for whatever the page is about.
 *
 * Inside a client, that client's health. Elsewhere, a count: "2 clients need
 * attention" sends an agency somewhere, where a single worst-case word does
 * not. The previous chip collapsed every connection in the organisation to
 * connected or disconnected, which meant one client's broken login was
 * invisible while another client's login still worked.
 *
 * Shared by the desk toolbar's chip and the phone More sheet's row, so the
 * two never word the same state differently.
 */
function useContextHealth() {
  const business = useWorkspaceMode() === "business"
  // A business has no client layer to scope by: the chip reports the whole
  // business and links to Listings.
  const clientId = useClientScope()
  const clients = useClients()
  const org = useOrgHealth(business ? "business" : "agency")

  const scoped =
    clientId && !business
      ? clients.data?.items.find((client) => client.id === clientId)
      : undefined

  // A refetch that fails AFTER an earlier success means the numbers on screen
  // are last known, not current. Saying so is different from saying Google is
  // down: the connection may be fine and it is our own server we cannot
  // reach, and an operator acting on stale counts would double-reply.
  const stale = clients.isError && clients.data !== undefined

  const tone = stale
    ? "attention"
    : scoped
      ? healthTone(scoped.health)
      : org.tone
  const label = stale
    ? "Data may be stale"
    : scoped
      ? healthLabel(scoped.health)
      : org.label
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
 * The desk toolbar's health chip: a bordered white pill with a status dot
 * and the words, always both (the colour never carries the meaning alone).
 * Phones show the same words as a row in the More sheet instead. It shrinks
 * with the toolbar, its words truncating, so the breadcrumb trail beside it
 * is never cut to stubs first (DSK-05).
 */
function ContextHealthChip() {
  const { tone, label, href, scopedName, isPending } = useContextHealth()

  if (isPending) return null
  return (
    <ShellLink
      href={href}
      data-slot="health-chip"
      data-tone={tone}
      className={cn(
        "inline-flex h-[34px] max-w-[min(22rem,34vw)] min-w-0 shrink items-center gap-2 rounded-full border border-line bg-surface px-3 text-ui font-medium whitespace-nowrap text-ink",
        "transition-colors duration-(--np-duration-fast) hover:border-line-strong",
        "focus-halo focus-visible:outline-none pointer-coarse:h-11"
      )}
    >
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", TONE_CLASSES[tone].dot)}
      />
      {/* One element, not a visible copy plus a screen-reader copy: two
          nodes carrying the same text make the chip ambiguous to "next item"
          navigation and to getByText. Below 1024px the client's name folds
          away; the words always show. */}
      <span className="min-w-0 truncate">
        {scopedName ? (
          <>
            <span className="max-lg:sr-only">{scopedName}:</span> {label}
          </>
        ) : (
          label
        )}
      </span>
    </ShellLink>
  )
}

/**
 * The health announcer, mounted once by the shell rather than inside a
 * chip: the chip only exists on the desk toolbar, and a live region inside
 * a `display: none` bar never speaks.
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

export { ContextHealthChip, ShellHealthAnnouncer, useContextHealth }
