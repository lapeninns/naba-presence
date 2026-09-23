"use client"

import Link from "next/link"
import * as React from "react"

import { healthLabel, healthTone } from "@/lib/clients/health"
import { useClients, useOrgHealth } from "@/lib/queries/use-clients"
import { TONE_CLASSES } from "@/lib/ui/status-tone"
import { cn } from "@/lib/utils"

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
 * A bordered white pill with a status dot and the words. Below 768px it is a
 * 44px circle with the dot alone; the words stay the link's accessible name.
 */
function ContextHealthChip() {
  const clientId = useClientScope()
  const clients = useClients()
  const org = useOrgHealth()

  const scoped = clientId
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
  const isPending = clients.isPending

  return (
    <>
      <HealthAnnouncer label={isPending ? null : label} />
      {isPending ? null : (
        <Link
          href={clientId ? `/clients/${clientId}` : "/clients"}
          data-slot="health-chip"
          data-tone={tone}
          className={cn(
            "inline-flex h-[34px] max-w-[min(22rem,34vw)] min-w-0 shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-3 text-ui font-medium whitespace-nowrap text-ink",
            "transition-colors duration-(--np-duration-fast) hover:border-line-strong",
            "focus-halo focus-visible:outline-none",
            "max-md:size-11 max-md:justify-center max-md:px-0"
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              TONE_CLASSES[tone].dot
            )}
          />
          {/* One element, not a visible copy plus a screen-reader copy: two
              nodes carrying the same text make the chip ambiguous to "next
              item" navigation and to getByText. On phones the dot alone
              shows and the words stay in the accessibility tree. */}
          <span className="min-w-0 truncate max-md:sr-only">
            {scoped && !stale ? (
              <>
                <span className="max-lg:sr-only">{scoped.name}:</span> {label}
              </>
            ) : (
              label
            )}
          </span>
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
