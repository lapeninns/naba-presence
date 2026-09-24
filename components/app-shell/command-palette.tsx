"use client"

import {
  ArrowRightLeft,
  Building2,
  Inbox,
  MapPin,
  Plus,
  Search,
  Settings,
  Store,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"
import { StatusPill } from "@/components/ui/status-pill"
import { healthTone } from "@/lib/clients/health"
import { withClientScope } from "@/lib/clients/scope"
import { settingsGatingFromRole } from "@/lib/settings/gating"
import { useClients } from "@/lib/queries/use-clients"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"

import { useRememberedClient } from "./client-context"
import { useClientSwitch } from "./client-switcher"

type PaletteEntry = {
  href: string
  label: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  /**
   * Owner/admin destinations: their pages answer anyone else with Access
   * denied, so the palette does not offer them (the rule the sidebar and the
   * settings tabs follow).
   */
  adminOnly?: boolean
}

const GO_TO: PaletteEntry[] = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/listings", label: "Listings", icon: Store },
  { href: "/clients", label: "Clients", icon: Building2 },
  { href: "/reports", label: "Reports", icon: TrendingUp },
  { href: "/team", label: "Team", icon: Users, adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings },
]

const ACTIONS: PaletteEntry[] = [
  { href: "/clients/new", label: "New client", icon: Plus, adminOnly: true },
  {
    href: "/settings/connections",
    label: "Connect a Google account",
    icon: Plus,
    adminOnly: true,
  },
  {
    href: "/team",
    label: "Invite a teammate",
    icon: UserPlus,
    adminOnly: true,
  },
]

/** The entries this role can use; everything while the role is unknown. */
export function paletteEntriesFor(
  entries: PaletteEntry[],
  role: string | null
): PaletteEntry[] {
  if (role === null) return entries
  const managerial = settingsGatingFromRole(role).canManageTeam
  return entries.filter((entry) => !entry.adminOnly || managerial)
}

const ICON_CLASS = "size-4 shrink-0 text-ink-muted"

/**
 * Jump to anything: a client, a location, a page, an action.
 *
 * The agency IA is genuinely deep — client, then location, then section — and
 * an operator who knows the venue's name should not have to walk the tree to
 * reach it. This is the shortcut across that depth, which is why it lists
 * locations by name with their client alongside.
 */
function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const clients = useClients()
  const role = useSessionRole()
  const locations = useLocationDirectory(role)
  const goTo = paletteEntriesFor(GO_TO, role)
  const actions = paletteEntriesFor(ACTIONS, role)
  // Go to Inbox, Listings or Reports keeps the client in scope, like the
  // sidebar's links.
  const { remembered } = useRememberedClient()

  const go = (href: string) => {
    onOpenChange(false)
    router.push(href)
  }

  const clientNameById = new Map(
    clients.data?.items.map((client) => [client.id, client.name]) ?? []
  )

  return (
    // "Commands", not "Search": this looks for clients, locations and actions,
    // and deliberately never looks inside review text. The Inbox's own
    // "Search reviews" field is the one place to type a customer's words, and
    // two fields that both look like search but answer different questions is
    // how an operator ends up believing a review does not exist.
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Commands"
      description="Jump to a client or a location, or run an action. To search review text, use Search reviews in the Inbox."
    >
      <CommandInput placeholder="Go to a client, a location or an action…" />
      <CommandList>
        <CommandEmpty>
          Nothing matched that. To search review text, use Search reviews in the
          Inbox.
        </CommandEmpty>

        {clients.data?.items.length ? (
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
                {location.clientId ? (
                  <span className="truncate text-caption text-ink-muted">
                    {clientNameById.get(location.clientId)}
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        <React.Suspense fallback={null}>
          <SwitchClientCommands onDone={() => onOpenChange(false)} />
        </React.Suspense>

        <CommandGroup heading="Go to">
          {goTo.map((item) => {
            const Icon = item.icon
            return (
              <CommandItem
                key={item.href}
                value={`go ${item.label}`}
                onSelect={() => go(withClientScope(item.href, remembered))}
              >
                <Icon className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
                {item.label}
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

/**
 * Opens the palette on the platform's own shortcut, and on `/` when the user
 * is not typing. The `/` binding is deliberately skipped inside inputs,
 * textareas and anything contenteditable, or it would eat a slash mid-sentence
 * in a reply the operator is writing.
 */
const OPEN_PALETTE_EVENT = "np:open-command-palette"

/**
 * Opens the toolbar's palette from anywhere on the page (the not-found
 * page's "Search clients and listings" button), without lifting the
 * palette's state out of the toolbar that owns it.
 */
function openCommandPalette() {
  document.dispatchEvent(new Event(OPEN_PALETTE_EVENT))
}

function useCommandPalette() {
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isShortcut = event.key === "k" && (event.metaKey || event.ctrlKey)
      const target = event.target as HTMLElement | null
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true
      if (isShortcut || (event.key === "/" && !isTyping)) {
        event.preventDefault()
        setOpen((previous) => !previous)
      }
    }
    const onOpenRequest = () => setOpen(true)
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener(OPEN_PALETTE_EVENT, onOpenRequest)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener(OPEN_PALETTE_EVENT, onOpenRequest)
    }
  }, [])

  return { open, setOpen }
}

const subscribeNever = () => () => {}

/**
 * The hint shows the key the viewer actually has. The server render cannot
 * know the platform, so it shows ⌘ and the client corrects to Ctrl after
 * hydration through the same snapshot split the theme toggle uses; a wrong
 * glyph for one frame beats a hydration mismatch.
 */
function useShortcutHint() {
  return useSyncPlatform() === "apple" ? "⌘K" : "Ctrl K"
}

function useSyncPlatform() {
  return React.useSyncExternalStore(
    subscribeNever,
    () => (/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "apple" : "other"),
    () => "apple"
  )
}

/**
 * The toolbar's search trigger. It looks like a field (a bordered white box
 * with a magnifier, a label and the shortcut) but it is a button that opens
 * the palette, because the palette is where typing goes. Below 768px it is a
 * 44px square with the magnifier alone; the label stays the accessible name.
 *
 * The label names its scope (clients, listings, pages and actions). Review
 * text is searched in the Inbox, in one clearly labelled field.
 */
function CommandPaletteButton({
  onClick,
  className,
}: {
  onClick: () => void
  className?: string
}) {
  const hint = useShortcutHint()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Search clients, listings, pages and actions"
      aria-haspopup="dialog"
      aria-keyshortcuts="Meta+K Control+K"
      className={cn(
        "flex h-[34px] shrink-0 items-center gap-2 rounded-md border border-line bg-surface pr-2 pl-2.5 text-ui text-ink-muted md:min-w-50",
        "transition-colors duration-(--np-duration-fast) hover:border-line-strong hover:text-ink",
        "focus-halo focus-visible:outline-none",
        "max-md:size-11 max-md:justify-center max-md:p-0",
        className
      )}
    >
      <Search className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      <span aria-hidden className="flex-1 truncate text-left max-md:hidden">
        Search clients, listings…
      </span>
      <Kbd aria-hidden className="ml-auto max-md:hidden">
        {hint}
      </Kbd>
    </button>
  )
}

export {
  CommandPalette,
  CommandPaletteButton,
  openCommandPalette,
  useCommandPalette,
  useShortcutHint,
}
