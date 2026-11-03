"use client"

import { Building2, CheckIcon } from "lucide-react"

import { ClientAvatar } from "@/components/clients/client-avatar"
import { healthTone } from "@/lib/clients/health"
import { clientScopeWords } from "@/lib/clients/scope-words"
import type { ClientSummary } from "@/lib/contracts/clients"
import { TONE_CLASSES } from "@/lib/ui/status-tone"
import { cn } from "@/lib/utils"

/**
 * The rows every client picker draws: the desk menu, the desk searchable
 * list (lazily loaded, client-switcher-search.tsx) and the phone sheet. They
 * live apart from client-switcher.tsx so the lazy search list can share them
 * without importing the switcher module back.
 */

/** The health tone as a dot. Decoration: a word always goes with it. */
function HealthDot({ client }: { client: ClientSummary }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        TONE_CLASSES[healthTone(client.health)].dot
      )}
    />
  )
}

/**
 * One row of the desk list, in the scope sheet's look: the client's mark,
 * its name, and beneath it its listings and health as muted words with the
 * tone dot ("9 listings · 1 needs attention"). The visible words are hidden
 * from the accessibility tree and read once, after the name, from the
 * `sr-only` copy ("Old Crown, 3 listings · In sync").
 */
function ClientOption({ client }: { client: ClientSummary }) {
  const words = clientScopeWords(client)
  return (
    <>
      <ClientAvatar name={client.name} colour={client.colour} size="xs" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{client.name}</span>
        <span
          aria-hidden
          className="flex min-w-0 items-center gap-1.5 text-caption font-normal text-ink-muted"
        >
          <HealthDot client={client} />
          <span className="truncate">{words}</span>
        </span>
      </span>
      <span className="sr-only">, {words}</span>
    </>
  )
}

/** The Building2 mark that stands for "every client". */
function AllClientsMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-(--np-radius-tag) bg-fill",
        className
      )}
    >
      <Building2 className="size-3.5" strokeWidth={1.75} />
    </span>
  )
}

function AllClientsOption() {
  return (
    <>
      <AllClientsMark />
      <span className="min-w-0 flex-1 truncate">All clients</span>
    </>
  )
}

/**
 * The menu's check column, for the lists that are not radio menus
 * (aria-current or aria-checked says it; the mark is for the eye). Ink, not
 * accent: the current place is neutral (DIRECTION D4).
 */
function CurrentMark({ current }: { current: boolean }) {
  return (
    <CheckIcon
      aria-hidden
      strokeWidth={2}
      className={cn("size-4 shrink-0 text-ink!", !current && "invisible")}
    />
  )
}

export {
  AllClientsMark,
  AllClientsOption,
  ClientOption,
  CurrentMark,
  HealthDot,
}
