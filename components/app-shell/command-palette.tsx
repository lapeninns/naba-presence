"use client"

import {
  Building2,
  Home,
  Inbox,
  MapPin,
  Plus,
  Search,
  Settings,
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
import { useClients } from "@/lib/queries/use-clients"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"

const GO_TO = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/clients", label: "Clients", icon: Building2 },
  { href: "/reports", label: "Reports", icon: TrendingUp },
  { href: "/team", label: "Team", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
]

const ACTIONS = [
  { href: "/clients/new", label: "New client", icon: Plus },
  {
    href: "/settings/connections",
    label: "Connect a Google account",
    icon: Plus,
  },
  { href: "/team", label: "Invite a teammate", icon: UserPlus },
]

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
  const locations = useLocationDirectory(useSessionRole())

  const go = (href: string) => {
    onOpenChange(false)
    router.push(href)
  }

  const clientNameById = new Map(
    clients.data?.items.map((client) => [client.id, client.name]) ?? []
  )

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search clients, locations and actions…" />
      <CommandList>
        <CommandEmpty>Nothing matched that.</CommandEmpty>

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
          <CommandGroup heading="Locations">
            {locations.data.map((location) => (
              <CommandItem
                key={location.id}
                value={`location ${location.name}`}
                onSelect={() => go(`/locations/${location.id}`)}
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

        <CommandGroup heading="Go to">
          {GO_TO.map((item) => {
            const Icon = item.icon
            return (
              <CommandItem
                key={item.href}
                value={`go ${item.label}`}
                onSelect={() => go(item.href)}
              >
                <Icon className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
                {item.label}
              </CommandItem>
            )
          })}
        </CommandGroup>

        <CommandGroup heading="Actions">
          {ACTIONS.map((item) => {
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
 * Opens the palette on the platform's own shortcut, and on `/` when the user
 * is not typing. The `/` binding is deliberately skipped inside inputs,
 * textareas and anything contenteditable, or it would eat a slash mid-sentence
 * in a reply the operator is writing.
 */
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
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
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
 * The toolbar's search field. It looks like a capsule search field — a grey
 * pill with a magnifier, "Search" and the shortcut — but it is a button that
 * opens the palette, because the palette is where typing goes. Below `sm`
 * only the magnifier shows; the label stays in the accessible name.
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
      className={cn(
        "flex h-(--np-control-h) items-center gap-2 rounded-(--np-radius-pill) bg-fill-secondary px-2.5 text-ui text-ink-muted sm:w-56 sm:px-3",
        "transition duration-(--np-duration-fast) ease-spring-snappy hover:bg-fill hover:text-ink active:scale-[0.98]",
        "focus-halo focus-visible:outline-none",
        className
      )}
    >
      <Search className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      <span className="sr-only flex-1 text-left sm:not-sr-only">Search</span>
      <Kbd className="hidden border-0 bg-transparent px-0 text-ink-muted sm:inline-flex">
        {hint}
      </Kbd>
    </button>
  )
}

export { CommandPalette, CommandPaletteButton, useCommandPalette }
