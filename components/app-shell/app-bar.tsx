"use client"

import { ChevronLeft } from "lucide-react"
import { usePathname } from "next/navigation"
import * as React from "react"

import type { BackTarget } from "@/lib/navigation/back-target"
import { destinationForPath } from "@/lib/navigation/destinations"
import { useClients } from "@/lib/queries/use-clients"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"
import type { WorkspaceMode } from "@/lib/workspace/terms"

import { useShellBack } from "./breadcrumbs-context"
import { ClientScopeChip, useScopeLabel } from "./client-switcher"
import { CommandPaletteButton } from "./command-palette"
import { NotificationsLink } from "./notifications-link"
import { type PageChromeOverride, usePageChromeOverride } from "./page-chrome"
import { ShellLink } from "./shell-link"
import { useNeedsReplyCount } from "./use-needs-reply-count"

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
    <ShellLink
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
    </ShellLink>
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
 * The view count after the echoed title ("Inbox 12", the Notion Mail
 * header): the page's own `<PageChrome count>` when it declared one;
 * otherwise, on the Inbox's list, its needs-reply count. Undefined (no
 * count shown) for 0 or unknown, and on a pushed detail, which is not the
 * list the count belongs to.
 */
function useViewCount({
  pathname,
  override,
  enabled,
}: {
  pathname: string | null
  override: PageChromeOverride
  enabled: boolean
}): number | undefined {
  const inboxList =
    pathname === INBOX_HREF &&
    override.count === undefined &&
    override.back === undefined
  // Shares the tab bar's query key, so this adds no request of its own.
  const needsReply = useNeedsReplyCount(enabled && inboxList)
  const count = override.count ?? (inboxList ? needsReply : undefined)
  return count && count > 0 ? count : undefined
}

const INBOX_HREF = "/inbox"

/**
 * The phone's top bar (below 768px), the Notion Mail header: sticky, 52px
 * plus the top safe area, on the canvas with the edge shadow below.
 *
 * - Leading: the labelled back control on a deep page; on a top-level page
 *   the workspace's name.
 * - The page title, from its h1, once the h1 has scrolled under the bar,
 *   with the view's count after it in muted figures.
 * - Trailing: at most two 44px controls. With a scope switcher to show:
 *   one action (search, or notifications where the page has its own
 *   search, the Inbox) then the scope trigger; the bell moves into More,
 *   whose tab carries its badge. Without one: search (left out on the
 *   Inbox, so one magnifier means one thing) and notifications.
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
  const count = useViewCount({ pathname, override, enabled: sessionReady })

  return (
    <header
      data-slot="app-bar"
      className="sticky top-0 z-chrome bg-canvas pt-safe px-safe shadow-np-edge-bottom md:hidden print:hidden"
    >
      <div className="flex h-(--np-appbar-h) items-center gap-1 pr-1 pl-2">
        <div className="flex max-w-1/2 min-w-0 shrink items-center">
          {sessionReady ? (
            <React.Suspense fallback={null}>
              <AppBarLeading organisationName={organisationName} />
            </React.Suspense>
          ) : null}
        </div>
        <div
          // The h1 is the page's title for assistive technology; this is a
          // visual echo of it (and of the view's count), so it is hidden
          // from the accessibility tree.
          aria-hidden
          data-slot="app-bar-heading"
          className={cn(
            "flex min-w-0 flex-1 items-baseline gap-1.5 px-1 text-title font-semibold text-ink",
            "transition-opacity duration-(--np-duration-fast)",
            title.visible ? "opacity-100" : "opacity-0"
          )}
        >
          <p
            aria-hidden
            data-slot="app-bar-title"
            data-visible={title.visible ? "true" : "false"}
            className="min-w-0 truncate"
          >
            {title.text}
          </p>
          {count !== undefined && title.text ? (
            <span
              data-slot="app-bar-count"
              className="shrink-0 font-normal text-ink-muted tabular-nums"
            >
              {count > 99 ? "99+" : count}
            </span>
          ) : null}
        </div>
        {sessionReady ? (
          <div
            data-slot="app-bar-actions"
            // Shrinks so a long scope name truncates rather than pushing the
            // row past a 320px screen; each control keeps its 44px.
            className="flex min-w-0 shrink items-center"
          >
            {ownSearch ? (
              <NotificationsLink />
            ) : (
              <CommandPaletteButton onClick={onOpenPalette} />
            )}
            {/* The scope reads the address (useSearchParams); the boundary
                keeps a prerendered page from bailing the whole bar out to
                client rendering. Until it resolves the slot is held blank,
                never the bell that the scope chip would then replace. */}
            <React.Suspense
              fallback={ownSearch ? null : <AppBarScopePending />}
            >
              <AppBarScopeSlot
                mode={mode}
                ownSearch={ownSearch}
                onOpenClientScope={onOpenClientScope}
              />
            </React.Suspense>
          </div>
        ) : null}
      </div>
    </header>
  )
}

/**
 * The trailing slot's second control: the scope trigger when there is a
 * scope to switch, otherwise the bell (unless the first control already is
 * the bell, on a page with its own search).
 */
function AppBarScopeSlot({
  mode,
  ownSearch,
  onOpenClientScope,
}: {
  mode: WorkspaceMode
  ownSearch: boolean
  onOpenClientScope: () => void
}) {
  // A business switches location, an agency client (then location); the
  // chip hides itself when there is nothing to switch.
  const scope = useScopeLabel(mode)
  // Whether there is anything to switch is unknown until the list that
  // decides it (an agency's clients, a business's locations) has loaded.
  // Same query keys as the switcher's, so nothing extra is fetched. The
  // server and the first client render agree on "pending".
  const clients = useClients({ enabled: mode === "agency" })
  const directory = useLocationDirectory(useSessionRole())
  const pending = mode === "agency" ? clients.isPending : directory.isPending
  if (scope.visible) {
    // Room for the leading name too: the chip gives way first.
    return (
      <ClientScopeChip
        mode={mode}
        onOpen={onOpenClientScope}
        className="max-w-[40vw]"
      />
    )
  }
  if (ownSearch) return null
  return pending ? <AppBarScopePending /> : <NotificationsLink />
}

/** The trailing slot held at one control's width while the scope loads. */
function AppBarScopePending() {
  return (
    <span
      aria-hidden
      data-slot="app-bar-scope-pending"
      className="size-11 shrink-0"
    />
  )
}

function AppBarLeading({
  organisationName,
}: {
  organisationName: string | null
}) {
  const back = useShellBack()
  if (back) return <ShellBackLink target={back} />
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
