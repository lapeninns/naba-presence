"use client"

import {
  ArrowRightLeft,
  Building2,
  MapPin,
  MessageSquareText,
} from "lucide-react"
import * as React from "react"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { StatusPill } from "@/components/ui/status-pill"
import { healthTone } from "@/lib/clients/health"
import { withClientScope } from "@/lib/clients/scope"
import { useGuardedRouter } from "@/lib/editors/use-leave-guard"
import {
  destinationHref,
  visibleDestinations,
} from "@/lib/navigation/destinations"
import { useClients } from "@/lib/queries/use-clients"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { useWorkspaceMode } from "@/lib/workspace/mode"
import type { WorkspaceMode } from "@/lib/workspace/terms"

import { useRememberedClient } from "./client-context"
import { useClientSwitch } from "./client-switcher"
import { PALETTE_ACTIONS, paletteEntriesFor } from "./command-palette"

/**
 * The palette's dialog itself: everything built on cmdk.
 *
 * Loaded lazily by `CommandPalette` (command-palette.tsx) the first time the
 * palette opens, or warmed when the pointer or focus reaches the toolbar's
 * button. cmdk brings a second dialog stack with it, and every route used to
 * pay for that in its first JavaScript for a palette most visits never open.
 * Nothing the shell imports statically may import this file.
 */

const ICON_CLASS = "size-4 shrink-0 text-ink-muted"

/**
 * The Inbox's review search with `query` filled in, keeping the remembered
 * client in agency mode like every other scoped link. The Inbox reads
 * `search` from its address (lib/inbox/url-state.ts).
 */
function reviewSearchHref(
  query: string,
  mode: WorkspaceMode,
  remembered: string | null
): string {
  const base =
    mode === "business" ? "/inbox" : withClientScope("/inbox", remembered)
  const joiner = base.includes("?") ? "&" : "?"
  return `${base}${joiner}search=${encodeURIComponent(query)}`
}

/**
 * Jump to anything: a client, a location, a page, an action; or hand the
 * words to the Inbox's review search.
 *
 * The agency IA is genuinely deep — client, then location, then section — and
 * an operator who knows the venue's name should not have to walk the tree to
 * reach it. This is the shortcut across that depth, which is why it lists
 * locations by name with their client alongside.
 */
function CommandPaletteDialog({
  open,
  onOpenChange,
  hideCalendar = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  hideCalendar?: boolean
}) {
  // Leaving an editor with unsaved edits from the palette asks first, the
  // way a sidebar link does.
  const router = useGuardedRouter()
  const clients = useClients()
  const role = useSessionRole()
  const locations = useLocationDirectory(role)
  const mode = useWorkspaceMode()
  const business = mode === "business"
  // The same destinations, in the same order and with the same gating, as
  // the tab bar, rail and sidebar (lib/navigation/destinations.ts).
  const goTo = visibleDestinations({ role, mode, hideCalendar })
  const actions = paletteEntriesFor(PALETTE_ACTIONS, role, mode)
  // Go to Inbox, Listings or Reports keeps the client in scope, like the
  // sidebar's links.
  const { remembered } = useRememberedClient()

  // Controlled so the typed words can be handed to the Inbox's search.
  // Cleared whenever the palette closes, however it closes (Escape, a
  // choice, or Cmd/Ctrl+K toggling it from outside), so it reopens on a
  // fresh field. Adjusted during render rather than in an effect, so the
  // stale words never paint.
  const [query, setQuery] = React.useState("")
  const [wasOpen, setWasOpen] = React.useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) setQuery("")
  }
  const trimmed = query.trim()

  const go = (href: string) => {
    onOpenChange(false)
    router.push(href)
  }

  const clientNameById = new Map(
    clients.data?.items.map((client) => [client.id, client.name]) ?? []
  )

  return (
    // "Commands", not "Search": this looks for clients, locations and
    // actions, and never looks inside review text itself. Review text is
    // searched by the Inbox's "Search reviews" field, so once the operator
    // has typed something the last row hands those words over to it,
    // rather than this field quietly failing to find a customer's words and
    // the operator concluding the review does not exist.
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Commands"
      description={
        business
          ? "Jump to a location or a page, or run an action. Type a customer's words to search reviews in the Inbox."
          : "Jump to a client or a location, or run an action. Type a customer's words to search reviews in the Inbox."
      }
    >
      {/* `text-body` keeps the field at 16px on a phone (iOS zooms the page
          on focus below that); the primitive's `text-title` is larger still
          where there is room. Nothing here sizes it down to `text-ui`. */}
      <CommandInput
        value={query}
        onValueChange={setQuery}
        className="max-sm:text-body"
        placeholder={
          business
            ? "Go to a location or an action, or search reviews…"
            : "Go to a client, a location or an action, or search reviews…"
        }
      />
      <CommandList>
        <CommandEmpty>
          Nothing matched that. To search review text, use Search reviews in the
          Inbox.
        </CommandEmpty>

        {!business && clients.data?.items.length ? (
          <CommandGroup heading="Clients">
            {clients.data.items.map((client) => (
              <CommandItem
                key={client.id}
                value={`client ${client.name}`}
                onSelect={() => go(`/clients/${client.id}`)}
              >
                <StatusPill tone={healthTone(client.health)} variant="dot" />
                <span className="flex-1 truncate">{client.name}</span>
                <span className="text-caption text-ink-muted tabular-nums">
                  {client.locationCount === 1
                    ? "1 location"
                    : `${client.locationCount} locations`}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {locations.data?.length ? (
          <CommandGroup heading="Listings">
            {locations.data.map((location) => (
              <CommandItem
                key={location.id}
                value={`listing ${location.name}`}
                onSelect={() => go(`/listings/${location.id}`)}
              >
                <MapPin className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
                <span className="flex-1 truncate">{location.name}</span>
                {!business && location.clientId ? (
                  <span className="truncate text-caption text-ink-muted">
                    {clientNameById.get(location.clientId)}
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {business ? null : (
          <React.Suspense fallback={null}>
            <SwitchClientCommands onDone={() => onOpenChange(false)} />
          </React.Suspense>
        )}

        <CommandGroup heading="Go to">
          {goTo.map((destination) => {
            const Icon = destination.icon
            return (
              <CommandItem
                key={destination.id}
                value={`go ${destination.label}`}
                onSelect={() =>
                  go(destinationHref(destination, mode, remembered))
                }
              >
                <Icon className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
                {destination.label}
              </CommandItem>
            )
          })}
        </CommandGroup>

        <CommandGroup heading="Actions">
          {actions.map((item) => {
            const Icon = item.icon
            return (
              <CommandItem
                key={item.label}
                value={`action ${item.label}`}
                onSelect={() => go(item.href)}
              >
                <Icon className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
                {item.label}
              </CommandItem>
            )
          })}
        </CommandGroup>
        {trimmed ? (
          // Always present while there is a query (`forceMount` keeps it
          // through the filter whatever the words) and always LAST: its
          // value never matches, so cmdk sorts it below every real match and
          // Enter still jumps to the client or listing the words name. With
          // nothing else matching it is the one row, and Enter searches.
          <CommandGroup heading="Search" forceMount>
            <CommandItem
              value="__review-search__"
              forceMount
              onSelect={() => go(reviewSearchHref(trimmed, mode, remembered))}
            >
              <MessageSquareText
                className={ICON_CLASS}
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="flex-1 truncate">
                Search reviews for “{trimmed}”
              </span>
            </CommandItem>
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}

/**
 * "Switch client: …" for every client but the current one, and "All
 * clients" while one is in scope. The same switch the top-bar switcher
 * makes, so it follows the same page rules and the Inbox's unsaved-reply
 * guard. Offered only when there is more than one client to switch between.
 */
function SwitchClientCommands({ onDone }: { onDone: () => void }) {
  const { clients, current, select } = useClientSwitch()
  if (!clients || clients.length <= 1) return null
  const choose = (clientId: string | null) => {
    onDone()
    void select(clientId)
  }
  return (
    <CommandGroup heading="Switch client">
      {current ? (
        <CommandItem
          value="switch client all clients"
          onSelect={() => choose(null)}
        >
          <Building2 className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
          <span className="flex-1 truncate">Switch client: All clients</span>
        </CommandItem>
      ) : null}
      {clients
        .filter((client) => client.id !== current)
        .map((client) => (
          <CommandItem
            key={client.id}
            value={`switch client ${client.name} ${client.id}`}
            onSelect={() => choose(client.id)}
          >
            <ArrowRightLeft
              className={ICON_CLASS}
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="flex-1 truncate">
              Switch client: {client.name}
            </span>
          </CommandItem>
        ))}
    </CommandGroup>
  )
}

export { CommandPaletteDialog }
