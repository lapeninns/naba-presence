"use client"

import {
  ArrowRightLeft,
  Building2,
  CircleX,
  MapPin,
  MessageSquareText,
  Search,
} from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { StatusPill } from "@/components/ui/status-pill"
import { healthTone } from "@/lib/clients/health"
import { withClientScope } from "@/lib/clients/scope"
import { useGuardedRouter } from "@/lib/editors/use-leave-guard"
import {
  destinationHref,
  visibleDestinations,
} from "@/lib/navigation/destinations"
import { useClients } from "@/lib/queries/use-clients"
import { mediaQuery } from "@/lib/ui/breakpoints"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { useWorkspaceMode } from "@/lib/workspace/mode"
import type { WorkspaceMode } from "@/lib/workspace/terms"
import { cn } from "@/lib/utils"

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
 * A result row: the primitive's 36px desk row (44px on a touch screen),
 * and a 48px row with room around the icon in the phone takeover.
 */
const ROW_CLASS = "max-md:min-h-12 max-md:gap-3 max-md:px-4"

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
  const inputRef = React.useRef<HTMLInputElement>(null)
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

  const groupClassName = trimmed ? undefined : "max-md:hidden"

  return (
    // "Commands", not "Search": this looks for clients, locations and
    // actions, and never looks inside review text itself. Review text is
    // searched by the Inbox's "Search reviews" field, so once the operator
    // has typed something the last row hands those words over to it,
    // rather than this field quietly failing to find a customer's words and
    // the operator concluding the review does not exist.
    //
    // One popup, two drawings, chosen by CSS alone (never a media query at
    // render): below `md` it is the full-screen search takeover (canvas,
    // a pill field and Cancel along the top, results between it and the
    // keyboard); from `md` it is the desk's ⌘K card, 12vh from the top.
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        presentation="dialog"
        showCloseButton={false}
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          // Phone: the takeover. Pinned to the top and to the keyboard's
          // top edge, inside the safe areas.
          "max-md:inset-x-0 max-md:top-0 max-md:bottom-(--np-keyboard-inset) max-md:left-0 max-md:max-h-none! max-md:w-full max-md:max-w-none! max-md:translate-x-0! max-md:translate-y-0! max-md:rounded-none max-md:bg-canvas max-md:pt-safe max-md:px-safe max-md:shadow-none",
          // Desk: the palette card, a menu radius, 12vh from the top.
          "md:top-[12vh] md:max-w-(--np-sheet-max-w) md:translate-y-0 md:rounded-(--np-radius-menu) md:data-starting-style:translate-y-2"
        )}
      >
        <DialogTitle className="sr-only">Commands</DialogTitle>
        <DialogDescription className="sr-only">
          {business
            ? "Jump to a location or a page, or run an action. Type a customer's words to search reviews in the Inbox."
            : "Jump to a client or a location, or run an action. Type a customer's words to search reviews in the Inbox."}
        </DialogDescription>
        <Command
          className="min-h-0 flex-1 bg-transparent"
          onKeyDown={(event) => {
            // Below `md` the groups stay hidden until something is typed,
            // but cmdk still highlights the first (hidden) row; Enter must
            // never open a row the operator cannot see. Read at event time:
            // behaviour, not layout.
            if (event.key === "Enter" && !trimmed && isBelowDesk()) {
              event.preventDefault()
            }
          }}
        >
          <div
            data-slot="command-palette-bar"
            className="flex shrink-0 items-center gap-1 max-md:py-2 max-md:pr-1 max-md:pl-3 md:border-b md:border-line"
          >
            {/* The field: a pill on a phone, the card's borderless top row
                at the desk. The primitive's own row keeps its magnifier;
                its hairline moves to this row so the clear button sits
                inside the same line. */}
            <div
              className={cn(
                "flex h-11 min-w-0 flex-1 items-center md:h-14",
                "max-md:rounded-full max-md:bg-fill",
                "[&_[data-slot=command-search]]:min-w-0 [&_[data-slot=command-search]]:flex-1 [&_[data-slot=command-search]]:border-0",
                "max-md:[&_[data-slot=command-search]]:gap-2 max-md:[&_[data-slot=command-search]]:pr-1 max-md:[&_[data-slot=command-search]]:pl-3"
              )}
            >
              {/* `text-body` keeps the field at 16px on a phone (iOS zooms
                  the page on focus below that); the primitive's
                  `text-title` is larger still at the desk. Nothing here
                  sizes it down to `text-ui`. */}
              <CommandInput
                ref={inputRef}
                value={query}
                onValueChange={setQuery}
                className="max-md:h-11 max-md:text-body"
                placeholder={
                  business
                    ? "Go to a location or an action, or search reviews…"
                    : "Go to a client, a location or an action, or search reviews…"
                }
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery("")
                    inputRef.current?.focus()
                  }}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted focus-halo transition-colors duration-(--np-duration-fast) hover:text-ink focus-visible:outline-none md:mr-2"
                >
                  <CircleX className="size-4" strokeWidth={1.75} aria-hidden />
                </button>
              ) : null}
            </div>
            <DialogClose
              render={
                <Button
                  variant="link"
                  className="min-h-11 px-2! text-body no-underline md:hidden"
                />
              }
            >
              Cancel
            </DialogClose>
          </div>

          {/* The takeover's resting state: nothing typed yet. The desk
              lists everything at once, so this is a phone-only line. */}
          {trimmed ? null : (
            <div
              data-slot="command-palette-hint"
              className="flex flex-col items-center gap-2 px-6 py-16 text-center text-ink-muted md:hidden"
            >
              <Search className="size-5" strokeWidth={1.75} aria-hidden />
              <p className="text-body">
                {business
                  ? "Search listings and pages"
                  : "Search clients, listings and pages"}
              </p>
            </div>
          )}

          <CommandList className="max-md:max-h-none max-md:min-h-0 max-md:flex-1 max-md:px-0 max-md:pb-safe">
            <CommandEmpty>
              {trimmed
                ? `Nothing matched “${trimmed}”. To search review text, choose Search reviews below.`
                : "Nothing matched that."}
            </CommandEmpty>

            {!business && clients.data?.items.length ? (
              <CommandGroup
                heading={<GroupHeading>Clients</GroupHeading>}
                className={groupClassName}
              >
                {clients.data.items.map((client) => (
                  <CommandItem
                    key={client.id}
                    value={`client ${client.name}`}
                    onSelect={() => go(`/clients/${client.id}`)}
                    className={ROW_CLASS}
                  >
                    <StatusPill
                      tone={healthTone(client.health)}
                      variant="dot"
                    />
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
              <CommandGroup
                heading={<GroupHeading>Listings</GroupHeading>}
                className={groupClassName}
              >
                {locations.data.map((location) => (
                  <CommandItem
                    key={location.id}
                    value={`listing ${location.name}`}
                    onSelect={() => go(`/listings/${location.id}`)}
                    className={ROW_CLASS}
                  >
                    <MapPin
                      className={ICON_CLASS}
                      strokeWidth={1.75}
                      aria-hidden
                    />
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
                <SwitchClientCommands
                  onDone={() => onOpenChange(false)}
                  className={groupClassName}
                />
              </React.Suspense>
            )}

            <CommandGroup
              heading={<GroupHeading>Go to</GroupHeading>}
              className={groupClassName}
            >
              {goTo.map((destination) => {
                const Icon = destination.icon
                return (
                  <CommandItem
                    key={destination.id}
                    value={`go ${destination.label}`}
                    onSelect={() =>
                      go(destinationHref(destination, mode, remembered))
                    }
                    className={ROW_CLASS}
                  >
                    <Icon
                      className={ICON_CLASS}
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    {destination.label}
                  </CommandItem>
                )
              })}
            </CommandGroup>

            <CommandGroup
              heading={<GroupHeading>Actions</GroupHeading>}
              className={groupClassName}
            >
              {actions.map((item) => {
                const Icon = item.icon
                return (
                  <CommandItem
                    key={item.label}
                    value={`action ${item.label}`}
                    onSelect={() => go(item.href)}
                    className={ROW_CLASS}
                  >
                    <Icon
                      className={ICON_CLASS}
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    {item.label}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {trimmed ? (
              // Always present while there is a query (`forceMount` keeps
              // it through the filter whatever the words) and always LAST:
              // its value never matches, so cmdk sorts it below every real
              // match and Enter still jumps to the client or listing the
              // words name. With nothing else matching it is the one row,
              // and Enter searches.
              <CommandGroup
                heading={<GroupHeading>Search</GroupHeading>}
                forceMount
              >
                <CommandItem
                  value="__review-search__"
                  forceMount
                  onSelect={() =>
                    go(reviewSearchHref(trimmed, mode, remembered))
                  }
                  className={ROW_CLASS}
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
        </Command>
      </DialogContent>
    </Dialog>
  )
}

/** Whether the phone takeover is showing (below `md`), asked at event time. */
function isBelowDesk(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    !window.matchMedia(mediaQuery("md")).matches
  )
}

/**
 * A group's label in the Notion Mail manner: sentence case, the UI size,
 * muted, set inside the primitive's mono uppercase heading slot so it
 * overrides it by inheritance (the slot's padding still applies). It is
 * still the heading cmdk names the group by.
 */
function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-sans text-ui tracking-normal text-ink-muted normal-case">
      {children}
    </span>
  )
}

/**
 * "Switch client: …" for every client but the current one, and "All
 * clients" while one is in scope. The same switch the top-bar switcher
 * makes, so it follows the same page rules and the Inbox's unsaved-reply
 * guard. Offered only when there is more than one client to switch between.
 */
function SwitchClientCommands({
  onDone,
  className,
}: {
  onDone: () => void
  className?: string
}) {
  const { clients, current, select } = useClientSwitch()
  if (!clients || clients.length <= 1) return null
  const choose = (clientId: string | null) => {
    onDone()
    void select(clientId)
  }
  return (
    <CommandGroup
      heading={<GroupHeading>Switch client</GroupHeading>}
      className={className}
    >
      {current ? (
        <CommandItem
          value="switch client all clients"
          onSelect={() => choose(null)}
          className={ROW_CLASS}
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
            className={ROW_CLASS}
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
