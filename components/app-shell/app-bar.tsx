"use client"

import { ChevronLeft } from "lucide-react"
import { usePathname } from "next/navigation"
import * as React from "react"

import type { BackTarget } from "@/lib/navigation/back-target"
import { clientPageKind } from "@/lib/clients/scope"
import {
  destinationForPath,
  entityBackLabel,
  isListingAreaPath,
  shortBackLabel,
} from "@/lib/navigation/destinations"
import { useClients } from "@/lib/queries/use-clients"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"
import type { WorkspaceMode } from "@/lib/workspace/terms"

import { useShellBack } from "./breadcrumbs-context"
import { ClientScopeChip, useScopeLabel } from "./client-switcher"
import { CommandPaletteButton } from "./command-palette"
import { NotificationsLink } from "./notifications-link"
import {
  type PageChromeOverride,
  type ShellAction,
  usePageChromeOverride,
} from "./page-chrome"
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
 *
 * `title` always carries the full label, so a shortened or truncated one
 * still says where it goes.
 */
function ShellBackLink({
  target,
  shortLabel,
  className,
}: {
  target: BackTarget
  /** The label drawn instead of the target's, when the bar is short of room. */
  shortLabel?: string
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
      <span className="min-w-0 truncate">{shortLabel ?? target.label}</span>
    </ShellLink>
  )
}

/**
 * Calls `onChange` with whether `element` has scrolled up under the app bar
 * (its bottom edge above the bar's bottom edge). The bar covers the top of
 * the viewport, so "scrolled away" means gone under the bar, not off the
 * screen. Returns the disconnect, or null where there is no
 * IntersectionObserver (the element then counts as on screen).
 */
function observeScrolledAway(
  element: HTMLElement,
  onChange: (away: boolean) => void
): (() => void) | null {
  if (typeof IntersectionObserver === "undefined") return null
  const bar = document.querySelector<HTMLElement>('[data-slot="app-bar"]')
  const top = bar?.getBoundingClientRect().height ?? 0
  const intersection = new IntersectionObserver(
    ([entry]) => {
      if (!entry) return
      onChange(entry.boundingClientRect.bottom <= top + 1)
    },
    { rootMargin: `-${Math.round(top)}px 0px 0px 0px`, threshold: 0 }
  )
  intersection.observe(element)
  return () => intersection.disconnect()
}

/**
 * The page's h1 text, visible in the bar only once the h1 has scrolled up
 * under it (the large-title pattern). While the h1 is on screen the bar
 * shows the workspace name instead, so it never repeats the heading right
 * below it; once the heading is gone the two cross-fade and the bar says
 * where you are, in the h1's own words. A
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
    let stop: (() => void) | null = null

    const watch = () => {
      const next = main.querySelector<HTMLElement>("h1")
      const text = next?.textContent?.trim() ?? ""
      if (next === observed) {
        setHeading((previous) =>
          previous.text === text ? previous : { ...previous, text }
        )
        return
      }
      stop?.()
      stop = null
      observed = next
      if (!next) {
        setHeading({ text: "", hidden: false })
        return
      }
      setHeading({ text, hidden: false })
      stop = observeScrolledAway(next, (above) =>
        setHeading((previous) =>
          previous.hidden === above ? previous : { ...previous, hidden: above }
        )
      )
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
      stop?.()
    }
  }, [pathname])

  return {
    text: override ?? heading.text,
    visible: heading.hidden && Boolean(override ?? heading.text),
  }
}

/**
 * Whether the page header's own actions (`PageHeader` `actions`, marked
 * `data-slot="page-header-actions"`) have scrolled under the bar: the moment
 * a page's `<PageChrome action>` takes over in the bar. Null while `enabled`
 * is off or the page has no such element, so the caller falls back to the
 * h1's signal.
 */
function useHeaderActionsAway(enabled: boolean): boolean | null {
  const pathname = usePathname()
  const [away, setAway] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    const main = document.getElementById("main")
    if (!enabled || !main) return
    let observed: HTMLElement | null = null
    let stop: (() => void) | null = null

    const watch = () => {
      const next = main.querySelector<HTMLElement>(
        '[data-slot="page-header-actions"]'
      )
      if (next === observed) return
      stop?.()
      stop = null
      observed = next
      setAway(next ? false : null)
      if (next) stop = observeScrolledAway(next, setAway)
    }

    watch()
    const mutations = new MutationObserver(watch)
    mutations.observe(main, { childList: true, subtree: true })
    return () => {
      mutations.disconnect()
      stop?.()
    }
  }, [pathname, enabled])

  return enabled ? away : null
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
 * - Leading: the labelled back control on a deep page.
 * - One title at a time, from the first row's left edge to the trailing
 *   controls: the workspace's name while the page's h1 is on screen, then,
 *   once the h1 has scrolled under the bar, the page title in the h1's own
 *   words (the name fades out as the title fades in, a plain swap under
 *   reduced motion), with the view's count after it in muted figures. On a
 *   deep page the back label shortens to "‹ Listing" beside the title.
 * - Trailing: two 44px controls (a third, the page's own action, joins
 *   them below). With a scope switcher to show:
 *   one action (search, or notifications where the page has its own
 *   search, the Inbox) then the scope trigger; the bell moves into More,
 *   whose tab carries its badge. Without one: search (left out on the
 *   Inbox, so one magnifier means one thing) and notifications. An
 *   organisation-wide page (`scoped: false` in the destination registry:
 *   Team, Settings, Notifications) always gets search and notifications,
 *   never the scope trigger it would ignore.
 *
 * - A page's primary action (`<PageChrome action>`) joins the trailing
 *   controls as a third, in front of them, once the page header's own
 *   actions have scrolled under the bar (the h1, for a header with none):
 *   the header button is gone from view, so the bar takes over and the two
 *   are never on screen together (SET-25).
 *
 * Every label that can still truncate carries its full value in `title`
 * (the back control, the workspace name, the title, the scope's name).
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
  const actionsAway = useHeaderActionsAway(Boolean(override.action))
  const destination = destinationForPath(pathname)
  const ownSearch = destination?.ownSearch === true
  const orgWide = destination?.scoped === false
  const count = useViewCount({ pathname, override, enabled: sessionReady })

  return (
    <header
      data-slot="app-bar"
      className="sticky top-0 z-chrome bg-canvas pt-safe px-safe shadow-np-edge-bottom md:hidden print:hidden"
    >
      <div className="flex h-(--np-appbar-h) items-center gap-1 pr-1 pl-2">
        <div
          data-slot="app-bar-lead"
          className="flex min-w-0 flex-1 items-center"
        >
          {sessionReady ? (
            <React.Suspense fallback={null}>
              <AppBarLeading
                organisationName={organisationName}
                title={title}
                count={count}
              />
            </React.Suspense>
          ) : null}
        </div>
        {sessionReady ? (
          <div
            data-slot="app-bar-actions"
            // Shrinks so a long scope name truncates rather than pushing the
            // row past a 320px screen; each control keeps its 44px.
            className="flex min-w-0 shrink items-center"
          >
            {/* The page's primary action, only once the header's own actions
                have scrolled away (the h1, for a header with none); see
                PageChrome `action`. */}
            {override.action && (actionsAway ?? title.visible) ? (
              <AppBarAction action={override.action} />
            ) : null}
            {orgWide ? (
              <>
                <CommandPaletteButton onClick={onOpenPalette} />
                <NotificationsLink />
              </>
            ) : (
              <>
                {ownSearch ? (
                  <NotificationsLink />
                ) : (
                  <CommandPaletteButton onClick={onOpenPalette} />
                )}
                {/* The scope reads the address (useSearchParams); the
                    boundary keeps a prerendered page from bailing the whole
                    bar out to client rendering. Until it resolves the slot
                    is held blank, never the bell that the scope chip would
                    then replace. */}
                <React.Suspense
                  fallback={ownSearch ? null : <AppBarScopePending />}
                >
                  <AppBarScopeSlot
                    mode={mode}
                    ownSearch={ownSearch}
                    titleVisible={title.visible}
                    onOpenClientScope={onOpenClientScope}
                  />
                </React.Suspense>
              </>
            )}
          </div>
        ) : null}
      </div>
    </header>
  )
}

/**
 * The page's primary action as a trailing 44px control (`<PageChrome
 * action>`): an icon button when the page gave an icon, otherwise its label
 * as text. Either way its accessible name is the label, and it is the same
 * name the page's header button carries.
 */
function AppBarAction({ action }: { action: ShellAction }) {
  const Icon = action.icon
  const pending = Boolean(action.pending) && !action.href
  // Inert while pending but still focusable, like Button's pending state:
  // focus stays put and the new name is announced.
  const name =
    pending && action.pendingLabel ? action.pendingLabel : action.label
  const className = cn(
    "grid h-11 min-w-11 shrink-0 place-items-center rounded-md text-accent-ink",
    "transition-colors duration-(--np-duration-fast) hover:bg-fill",
    "focus-halo focus-visible:outline-none aria-busy:cursor-progress aria-disabled:opacity-50",
    Icon ? "w-11" : "px-2 text-ui font-medium whitespace-nowrap"
  )
  const content = Icon ? (
    <Icon className="size-5" strokeWidth={2} aria-hidden />
  ) : (
    name
  )
  if (action.href) {
    return (
      <ShellLink
        href={action.href}
        data-slot="app-bar-action"
        aria-label={Icon ? name : undefined}
        title={Icon ? name : undefined}
        className={className}
      >
        {content}
      </ShellLink>
    )
  }
  return (
    <button
      type="button"
      data-slot="app-bar-action"
      aria-label={Icon ? name : undefined}
      title={Icon ? name : undefined}
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      onClick={pending ? undefined : action.onSelect}
      className={className}
    >
      {content}
    </button>
  )
}

/**
 * The trailing slot's second control: the scope trigger when there is a
 * scope to switch, otherwise the bell (unless the first control already is
 * the bell, on a page with its own search).
 *
 * The trigger drops its name and keeps the mark where the name would only
 * repeat or squeeze: on a client's own page (the title and the back label
 * already say which client) and on a deep page while its title is echoed
 * (the name would leave the title a few letters). The name stays in the
 * accessible name, and in the scope sheet.
 */
function AppBarScopeSlot({
  mode,
  ownSearch,
  titleVisible,
  onOpenClientScope,
}: {
  mode: WorkspaceMode
  ownSearch: boolean
  titleVisible: boolean
  onOpenClientScope: () => void
}) {
  const pathname = usePathname()
  const back = useShellBack()
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
    const markOnly =
      (clientPageKind(pathname) === "client" && scope.client !== null) ||
      (back !== null && titleVisible)
    // Room for the title too: the chip gives way first.
    if (ownSearch) {
      return (
        <ClientScopeChip
          mode={mode}
          onOpen={onOpenClientScope}
          labelled={!markOnly}
          className="max-w-[40vw]"
        />
      )
    }
    // While a task's ActionBar or SelectionBar is docked the tab bar steps
    // aside, taking More's unread badge with it, so the bell (and its count)
    // takes the chip's place. The same CSS chrome contract that hides the tab
    // bar (globals.css) swaps them: no JS reads the dock, so the server and
    // the first client render agree.
    return (
      <>
        <NotificationsLink className="hidden [body:has([data-docked=bottom])_&]:grid" />
        <ClientScopeChip
          mode={mode}
          onOpen={onOpenClientScope}
          labelled={!markOnly}
          className="max-w-[40vw] [body:has([data-docked=bottom])_&]:hidden"
        />
      </>
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

/**
 * The bar's leading half: the back control (a deep page) and the one title
 * beside it. On a top-level page the workspace's name and the page's title
 * echo share one cell and cross-fade, so the name never sits beside a
 * squeezed title. Both are `visibility`-switched with the fade, so the one
 * that is faded out is also out of the tab order and the accessibility
 * tree; under reduced motion (the global rule shortens the transition) it
 * is a plain swap.
 */
function AppBarLeading({
  organisationName,
  title,
  count,
}: {
  organisationName: string | null
  title: { text: string; visible: boolean }
  count: number | undefined
}) {
  const back = useShellBack()
  const pathname = usePathname()
  const name = organisationName ?? "NabaPresence"
  // A listing area's header row already names the listing, so its back
  // control says what it goes back to ("‹ Listing") from the start, even
  // for a short name; elsewhere the full label stays until the title echo
  // takes its place.
  const shortLabel = !back
    ? undefined
    : isListingAreaPath(pathname)
      ? (entityBackLabel(back) ?? shortBackLabel(back))
      : title.visible
        ? shortBackLabel(back)
        : undefined
  const fade =
    "transition-[opacity,visibility] duration-(--np-duration-fast) motion-reduce:transition-none"
  return (
    <>
      {back ? <ShellBackLink target={back} shortLabel={shortLabel} /> : null}
      <div className="grid min-w-0 flex-1 items-center">
        {back ? null : (
          <span
            data-slot="workspace-name"
            data-visible={title.visible ? "false" : "true"}
            title={name}
            className={cn(
              "col-start-1 row-start-1 min-w-0 truncate px-1 text-ui font-semibold text-ink",
              fade,
              title.visible ? "invisible opacity-0" : "visible opacity-100"
            )}
          >
            {name}
          </span>
        )}
        <div
          // The h1 is the page's title for assistive technology; this is a
          // visual echo of it (and of the view's count), so it is hidden
          // from the accessibility tree.
          aria-hidden
          data-slot="app-bar-heading"
          className={cn(
            "col-start-1 row-start-1 flex min-w-0 items-baseline gap-1.5 px-1 text-title font-semibold text-ink",
            fade,
            title.visible ? "visible opacity-100" : "invisible opacity-0"
          )}
        >
          <p
            aria-hidden
            data-slot="app-bar-title"
            data-visible={title.visible ? "true" : "false"}
            title={title.text}
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
      </div>
    </>
  )
}

export { AppBar, ShellBackLink }
