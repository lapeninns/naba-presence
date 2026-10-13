"use client"

import { ChevronLeft } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import * as React from "react"

import type { BackTarget } from "@/lib/navigation/back-target"
import { destinationForPath } from "@/lib/navigation/destinations"
import { cn } from "@/lib/utils"
import type { WorkspaceMode } from "@/lib/workspace/terms"

import { useShellBack } from "./breadcrumbs-context"
import { ClientScopeChip, useClientScopeLabel } from "./client-switcher"
import { CommandPaletteButton } from "./command-palette"
import { NotificationsLink } from "./notifications-link"
import { usePageChromeOverride } from "./page-chrome"

/**
 * The labelled way up from a deep page: "‹ Listings". Its name is "Back to
 * Listings", which starts with nothing the eye can't see but keeps the
 * visible label inside it (WCAG 2.5.3). The phone app bar and the tablet
 * toolbar share it.
 *
 * When the page declared its own way back (`<PageChrome onBack>`, the
 * Inbox's pushed review), a plain click or Enter runs that instead of
 * following the link; a modified click (new tab, new window) still follows
 * `href`, which is why it stays a link.
 */
function ShellBackLink({
  target,
  className,
}: {
  target: BackTarget
  className?: string
}) {
  // The page's handler arrives on the override, which useShellBack returns
  // as the target itself when the page declared one.
  const override = usePageChromeOverride().back
  const onNavigate =
    override && override === target ? override.onNavigate : undefined
  return (
    <Link
      href={target.href}
      data-slot="back-control"
      title={target.label}
      onClick={
        onNavigate
          ? (event) => {
              if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              ) {
                return
              }
              event.preventDefault()
              onNavigate()
            }
          : undefined
      }
      className={cn(
        "flex h-11 max-w-full min-w-0 items-center gap-0.5 rounded-md pr-2 pl-1 text-ui font-medium text-accent-ink",
        "transition-colors duration-(--np-duration-fast) hover:bg-fill",
        "focus-halo focus-visible:outline-none",
        className
      )}
    >
      <ChevronLeft className="size-5 shrink-0" strokeWidth={2} aria-hidden />
      {/* The space is a text node between the spans, not trailing inside
          the sr-only one: name computation trims each element's text, so
          "Back to " + "Listings" came out as "Back toListings". In a flex
          row a whitespace-only text node draws nothing. */}
      <span className="sr-only">Back to</span>{" "}
      <span className="min-w-0 truncate">{target.label}</span>
    </Link>
  )
}

/**
 * The page's h1 text, visible in the bar only once the h1 has scrolled up
 * under it (the large-title pattern). While the h1 is on screen the bar
 * shows no title, so it never repeats the heading right below it; once the
 * heading is gone the bar says where you are, in the h1's own words. A
 * page's `<PageChrome title>` may shorten them.
 *
 * Read from the DOM rather than pushed by pages: every page already has
 * exactly one h1 (the axe suite pins it), so this is right on every page
 * without each one opting in.
 */
function useCompactTitle(override: string | undefined) {
  const pathname = usePathname()
  const [heading, setHeading] = React.useState<{
    text: string
    hidden: boolean
  }>({ text: "", hidden: false })

  React.useEffect(() => {
    const main = document.getElementById("main")
    if (!main) return
    let observed: HTMLElement | null = null
    let intersection: IntersectionObserver | null = null

    const watch = () => {
      const next = main.querySelector<HTMLElement>("h1")
      const text = next?.textContent?.trim() ?? ""
      if (next === observed) {
        setHeading((previous) =>
          previous.text === text ? previous : { ...previous, text }
        )
        return
      }
      intersection?.disconnect()
      observed = next
      if (!next) {
        setHeading({ text: "", hidden: false })
        return
      }
      setHeading({ text, hidden: false })
      if (typeof IntersectionObserver === "undefined") return
      // The bar covers the top of the viewport, so "scrolled away" means
      // gone under the bar, not off the screen.
      const bar = document.querySelector<HTMLElement>('[data-slot="app-bar"]')
      const top = bar?.getBoundingClientRect().height ?? 0
      intersection = new IntersectionObserver(
        ([entry]) => {
          if (!entry) return
          const above = entry.boundingClientRect.bottom <= top + 1
          setHeading((previous) =>
            previous.hidden === above
              ? previous
              : { ...previous, hidden: above }
          )
        },
        { rootMargin: `-${Math.round(top)}px 0px 0px 0px`, threshold: 0 }
      )
      intersection.observe(next)
    }

    watch()
    // Pages stream in and swap their h1 (a loading state, then the page).
    const mutations = new MutationObserver(watch)
    mutations.observe(main, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    return () => {
      mutations.disconnect()
      intersection?.disconnect()
    }
  }, [pathname])

  return {
    text: override ?? heading.text,
    visible: heading.hidden && Boolean(override ?? heading.text),
  }
}

/**
 * The phone's top bar (below 768px): sticky, 52px plus the top safe area.
 *
 * - Leading: the labelled back control on a deep page; on a top-level page
 *   the client being worked (agency, more than one client) or the
 *   workspace's name.
 * - The page title, from its h1, once the h1 has scrolled under the bar.
 * - At most two actions: search (the command palette; left out where the
 *   page has its own search, the Inbox, so one magnifier means one thing)
 *   and notifications with the unread count in its name.
 *
 * Connection health is not here as a dot: it is a labelled row in the More
 * sheet and words beside every client in the client sheet.
 */
function AppBar({
  mode,
  organisationName,
  sessionReady,
  onOpenPalette,
  onOpenClientScope,
}: {
  mode: WorkspaceMode
  organisationName: string | null
  sessionReady: boolean
  onOpenPalette: () => void
  onOpenClientScope: () => void
}) {
  const pathname = usePathname()
  const override = usePageChromeOverride()
  const title = useCompactTitle(override.title)
  const ownSearch = destinationForPath(pathname)?.ownSearch === true

  return (
    <header
      data-slot="app-bar"
      className="sticky top-0 z-chrome bg-canvas pt-safe px-safe shadow-np-edge-bottom md:hidden print:hidden"
    >
      <div className="flex h-(--np-appbar-h) items-center gap-1 pr-1 pl-2">
        <div className="flex max-w-1/2 min-w-0 shrink-0 items-center">
          {sessionReady ? (
            // The client scope reads the address (useSearchParams); the
            // boundary keeps a prerendered page from bailing the whole bar
            // out to client rendering.
            <React.Suspense fallback={null}>
              <AppBarLeading
                mode={mode}
                organisationName={organisationName}
                onOpenClientScope={onOpenClientScope}
              />
            </React.Suspense>
          ) : null}
        </div>
        <p
          // The h1 is the page's title for assistive technology; this is a
          // visual echo of it, so it is hidden from the accessibility tree.
          aria-hidden
          data-slot="app-bar-title"
          data-visible={title.visible ? "true" : "false"}
          className={cn(
            "min-w-0 flex-1 truncate px-1 text-title font-semibold text-ink",
            "transition-opacity duration-(--np-duration-fast)",
            title.visible ? "opacity-100" : "opacity-0"
          )}
        >
          {title.text}
        </p>
        {sessionReady && !ownSearch ? (
          <CommandPaletteButton onClick={onOpenPalette} />
        ) : null}
        {sessionReady ? <NotificationsLink /> : null}
      </div>
    </header>
  )
}

function AppBarLeading({
  mode,
  organisationName,
  onOpenClientScope,
}: {
  mode: WorkspaceMode
  organisationName: string | null
  onOpenClientScope: () => void
}) {
  const back = useShellBack()
  const scope = useClientScopeLabel()
  if (back) return <ShellBackLink target={back} />
  if (mode === "agency" && scope.visible) {
    return <ClientScopeChip onOpen={onOpenClientScope} />
  }
  return (
    <span
      data-slot="workspace-name"
      className="min-w-0 truncate px-1 text-ui font-semibold text-ink"
    >
      {organisationName ?? "NabaPresence"}
    </span>
  )
}

export { AppBar, ShellBackLink }
