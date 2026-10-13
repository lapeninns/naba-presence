"use client"

import { Plus, Search, UserPlus } from "lucide-react"
import dynamic from "next/dynamic"
import * as React from "react"

import { Kbd } from "@/components/ui/kbd"
import { DESTINATIONS } from "@/lib/navigation/destinations"
import { settingsGatingFromRole } from "@/lib/settings/gating"
import { useWorkspaceMode } from "@/lib/workspace/mode"
import type { WorkspaceMode } from "@/lib/workspace/terms"
import { cn } from "@/lib/utils"

/**
 * The command palette's light half: its trigger, its shortcuts, its entry
 * lists and the lazy mount. The dialog itself (everything built on cmdk) is
 * command-palette-dialog.tsx, loaded the first time the palette opens, so
 * cmdk and its second dialog stack stay out of every route's first
 * JavaScript. Keep it that way: nothing here may import `@/components/ui/
 * command` or `cmdk`, statically or through another module.
 */

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
  /** Hidden in business mode, which has no client layer. */
  agencyOnly?: boolean
}

/**
 * The "Go to" destinations as palette entries, derived from the one
 * destination registry (lib/navigation/destinations.ts) so the palette can
 * never drift from the navigation again. The palette itself filters the
 * registry with `visibleDestinations`, which also knows the scheduling
 * flag; this list stays for callers that use `paletteEntriesFor`.
 */
const GO_TO: PaletteEntry[] = DESTINATIONS.map((destination) => ({
  href: destination.href,
  label: destination.label,
  icon: destination.icon,
  adminOnly: destination.managersOnly,
  agencyOnly: destination.agencyOnly,
}))

const ACTIONS: PaletteEntry[] = [
  {
    href: "/clients/new",
    label: "New client",
    icon: Plus,
    adminOnly: true,
    agencyOnly: true,
  },
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
  role: string | null,
  mode: WorkspaceMode = "agency"
): PaletteEntry[] {
  const inMode = entries.filter(
    (entry) => !entry.agencyOnly || mode === "agency"
  )
  if (role === null) return inMode
  const managerial = settingsGatingFromRole(role).canManageTeam
  return inMode.filter((entry) => !entry.adminOnly || managerial)
}

export { GO_TO as PALETTE_GO_TO, ACTIONS as PALETTE_ACTIONS }

/**
 * One import shared by the lazy component and the warm-up, so warming on
 * hover and opening later fetch the same chunk once.
 */
const loadPaletteDialog = () => import("./command-palette-dialog")

const CommandPaletteDialog = dynamic(
  () => loadPaletteDialog().then((module) => module.CommandPaletteDialog),
  // Client-only: it never renders on the server, and nothing paints while
  // the chunk arrives (the dialog appears when it is ready).
  { ssr: false, loading: () => null }
)

/** Starts fetching the dialog before it is asked for. */
function warmCommandPalette() {
  void loadPaletteDialog()
}

/**
 * The palette, mounted lazily: nothing at all until it has been opened once,
 * then the dialog, which stays mounted so closing animates and reopening is
 * instant. `hideCalendar` is the organisation's `post_scheduling` flag being
 * off, read by the dashboard layout, so Go to never offers a Calendar the
 * navigation hides.
 */
function CommandPalette({
  open,
  onOpenChange,
  hideCalendar = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  hideCalendar?: boolean
}) {
  // Latches on the first open; adjusted during render, so the open that
  // flips it is the same render that mounts the dialog.
  const [opened, setOpened] = React.useState(open)
  if (open && !opened) setOpened(true)
  if (!opened) return null
  return (
    <CommandPaletteDialog
      open={open}
      onOpenChange={onOpenChange}
      hideCalendar={hideCalendar}
    />
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
  const business = useWorkspaceMode() === "business"
  return (
    <button
      type="button"
      onClick={onClick}
      // A pointer on its way to the button, or focus arriving on it, is a
      // good sign the palette is next: fetch the dialog now so it opens
      // without waiting on the network.
      onPointerEnter={warmCommandPalette}
      onFocus={warmCommandPalette}
      aria-label={
        business
          ? "Search listings, pages and actions"
          : "Search clients, listings, pages and actions"
      }
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
        {business ? "Search listings…" : "Search clients, listings…"}
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
