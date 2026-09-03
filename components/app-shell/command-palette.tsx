"use client"

import {
  Building2,
  Home,
  Inbox,
  MapPin,
  Plus,
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
  { href: "/settings/connections", label: "Connect a Google account", icon: Plus },
  { href: "/team", label: "Invite a teammate", icon: UserPlus },
]

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
                <span className="text-caption text-ink-muted">
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
                <MapPin className="size-4 text-ink-faint" aria-hidden />
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
                <Icon className="size-4 text-ink-faint" aria-hidden />
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
                <Icon className="size-4 text-ink-faint" aria-hidden />
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

function CommandPaletteButton({
  onClick,
  className,
}: {
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-2 rounded-(--np-radius-control) border border-line bg-surface px-2.5 text-ui text-ink-muted transition-colors duration-(--np-duration-fast) hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
        className
      )}
    >
      <span className="hidden sm:inline">Search</span>
      <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
      <span className="sm:hidden">Search clients and locations</span>
    </button>
  )
}

export { CommandPalette, CommandPaletteButton, useCommandPalette }
