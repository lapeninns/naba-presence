"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { LockIcon } from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Tabs for genuinely separate page sections (reference `.tabs`): a row of
 * labels over a hairline, muted until selected, with a 2px INK underline
 * inset 8px from the tab's edges. 44px tall on touch, 40px under `desk`.
 * Switching views of the same data is SegmentedControl's job.
 *
 * `TabNav` is the same drawing for tabs that are links between routes
 * (`aria-current="page"` rather than a tablist), such as a listing's areas.
 *
 * Navigation-strip rules (spec, prim-04/mux-05): the row scrolls sideways
 * rather than squeezing, so a label is never truncated mid-word; an edge
 * with more behind it fades out; and the current tab is scrolled into view
 * when the row mounts and whenever the current tab changes — a phone
 * landing on the eighth settings section sees it underlined, not three
 * other tabs. The visible words are the accessible name (WCAG 2.5.3): to
 * shorten a label on a phone use `shortLabel`, never an `aria-label` that
 * differs from what is shown.
 */
function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex min-w-0 flex-col gap-4", className)}
      {...props}
    />
  )
}

/**
 * The row: a hairline track that scrolls sideways without a scrollbar. When
 * tabs are hidden past an edge, that edge fades out (a CSS mask driven by
 * `data-fade`, see `useScrollFade`), so the row says there is more to scroll
 * to without drawing a scrollbar.
 */
const tabsRowClassName = cn(
  "relative flex min-w-0 [scrollbar-width:none] items-end gap-1 overflow-x-auto border-b border-line [&::-webkit-scrollbar]:hidden",
  "data-[fade=end]:[mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)]",
  "data-[fade=start]:[mask-image:linear-gradient(to_left,#000_calc(100%-2.5rem),transparent)]",
  "data-[fade=both]:[mask-image:linear-gradient(to_right,transparent,#000_2.5rem,#000_calc(100%-2.5rem),transparent)]"
)

/**
 * Keeps `data-fade` on a sideways-scrolling row in step with what is hidden:
 * "start", "end", "both", or absent when everything fits. Written straight
 * to the element (no React state), on scroll and on resize.
 */
function useScrollFade(ref: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    const row = ref.current
    if (!row) return
    const update = () => {
      const max = row.scrollWidth - row.clientWidth
      const start = row.scrollLeft > 1
      const end = max - row.scrollLeft > 1
      const fade = start && end ? "both" : start ? "start" : end ? "end" : ""
      if (fade) row.dataset.fade = fade
      else delete row.dataset.fade
    }
    update()
    row.addEventListener("scroll", update, { passive: true })
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update)
    observer?.observe(row)
    return () => {
      row.removeEventListener("scroll", update)
      observer?.disconnect()
    }
  }, [ref])
}

/**
 * Scrolls the current item of a sideways row into view, along the row only.
 * Not `scrollIntoView`: that would also scroll the page vertically, pulling
 * a phone's document away from where the reader is. An item already fully
 * visible is left alone; one outside is centred in the row.
 */
function scrollCurrentIntoRow(row: HTMLElement, current: HTMLElement | null) {
  if (!current) return
  const rowBox = row.getBoundingClientRect()
  const box = current.getBoundingClientRect()
  const start = box.left - rowBox.left + row.scrollLeft
  const visible =
    start >= row.scrollLeft &&
    start + box.width <= row.scrollLeft + row.clientWidth
  if (visible) return
  const left = start - (row.clientWidth - box.width) / 2
  row.scrollLeft = Math.max(
    0,
    Math.min(left, row.scrollWidth - row.clientWidth)
  )
}

/**
 * Keeps the row's current item (`selector`) in view: on mount, whenever the
 * caller's `key` changes (TabNav passes the current href), whenever the
 * item's state attribute flips (Base UI moves `data-active` on a tab
 * change without a React render of the list), and whenever the row or an
 * item changes size after mount (a late web font, a count arriving, the
 * shell's rail or sidebar settling), which can push a current item that
 * fitted at mount out of view. An item already in view is left alone, so a
 * resize never fights a sideways scroll the reader made.
 */
function useCurrentInView(
  ref: React.RefObject<HTMLElement | null>,
  selector: string,
  key?: unknown
) {
  React.useEffect(() => {
    const row = ref.current
    if (!row) return
    const reveal = () =>
      scrollCurrentIntoRow(row, row.querySelector<HTMLElement>(selector))
    reveal()
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reveal)
    if (resize) {
      resize.observe(row)
      for (const item of row.children) resize.observe(item)
    }
    const observer =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(reveal)
    observer?.observe(row, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-active", "aria-current", "aria-selected"],
    })
    return () => {
      observer?.disconnect()
      resize?.disconnect()
    }
  }, [ref, selector, key])
}

/** One tab or tab link. */
const tabItemClassName = cn(
  "relative inline-flex h-11 shrink-0 items-center gap-1.5 rounded-t-(--np-radius-tag) px-3 text-ui font-medium whitespace-nowrap text-ink-muted no-underline focus-halo transition-colors duration-(--np-duration-fast) ease-spring-snappy disabled:pointer-events-none disabled:opacity-50 hover-fine:hover:text-ink desk:h-10",
  "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent after:content-['']",
  "aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:after:bg-ink data-active:font-semibold data-active:text-ink data-active:after:bg-ink",
  "[&_svg]:shrink-0 [&_svg]:[stroke-width:1.75] [&_svg:not([class*='size-'])]:size-4"
)

/**
 * `fill` is the phone drawing of a short tab row: equal columns that divide
 * the width, rather than a scrolling strip. From `sm` it returns to the row.
 * A column is never narrower than its label: when the labels do not fit,
 * the row scrolls instead of clipping one.
 */
const FILL_CLASS = cn(
  "grid auto-cols-[minmax(max-content,1fr)] grid-flow-col gap-0",
  "[&_[data-slot=tabs-tab]]:justify-center [&_[data-slot=tabs-tab]]:px-2",
  "sm:flex sm:gap-1",
  "sm:[&_[data-slot=tabs-tab]]:justify-start sm:[&_[data-slot=tabs-tab]]:px-3"
)

function TabsList({
  className,
  children,
  fill = false,
  ...props
}: TabsPrimitive.List.Props & { fill?: boolean }) {
  const rowRef = React.useRef<HTMLDivElement>(null)
  useScrollFade(rowRef)
  useCurrentInView(rowRef, "[data-active]")
  return (
    <TabsPrimitive.List
      ref={rowRef}
      data-slot="tabs-list"
      data-fill={fill || undefined}
      className={cn(tabsRowClassName, fill && FILL_CLASS, className)}
      {...props}
    >
      {children}
    </TabsPrimitive.List>
  )
}

/**
 * A label with an optional phone-width short form. Only one of the two is
 * ever displayed, and the other is `display: none`, so it drops out of the
 * accessible name as well as the screen: the name is always exactly the
 * words on screen (label in name).
 */
function TabLabel({
  label,
  shortLabel,
}: {
  label: React.ReactNode
  shortLabel?: React.ReactNode
}) {
  if (shortLabel === undefined || shortLabel === null) return <>{label}</>
  return (
    <>
      <span className="sm:hidden">{shortLabel}</span>
      <span className="max-sm:hidden">{label}</span>
    </>
  )
}

function TabsTab({
  className,
  children,
  shortLabel,
  ...props
}: TabsPrimitive.Tab.Props & {
  /** Shown instead of the children below `sm` (see `TabLabel`). */
  shortLabel?: React.ReactNode
}) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(tabItemClassName, className)}
      {...props}
    >
      {shortLabel === undefined ? (
        children
      ) : (
        <TabLabel label={children} shortLabel={shortLabel} />
      )}
    </TabsPrimitive.Tab>
  )
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  // The panel is a Tab stop (Base UI), so it shows where focus is (WCAG
  // 2.4.7); the ring sits inside the box so a clipping parent cannot hide it.
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn(
        "rounded-(--np-radius-card) outline-none focus-visible:ring-2 focus-visible:ring-(--np-focus-ring) focus-visible:ring-inset",
        className
      )}
      {...props}
    />
  )
}

export type TabNavItem = {
  href: string
  label: React.ReactNode
  /** Shown instead of `label` below `sm` (see `TabLabel`). */
  shortLabel?: React.ReactNode
  current?: boolean
  /** A count or badge after the label. */
  badge?: React.ReactNode
  /**
   * Why this tab's section can't be used right now. On its own the link
   * still works (the page explains more), drawn muted with a lock and the
   * reason in its name. With `disabled`, the same reason explains why it
   * cannot be opened.
   */
  unavailableReason?: string | null
  /**
   * The section cannot be opened at all (listings-content-07: the phone's
   * area list and the desk's tabs must agree). Rendered as a link with no
   * `href` and `aria-disabled="true"`: announced as a disabled link, not in
   * the tab order, inert to a click or tap. Ignored on the current item:
   * the reader is already on that page (reached by URL), so it stays a
   * link with `aria-current` and the underline rather than leaving the row
   * with no current tab. `aria-current` is never put on a disabled link.
   */
  disabled?: boolean
}

/** A disabled tab: muted, no pointer feedback. */
const disabledTabClassName =
  "cursor-not-allowed font-normal opacity-60 hover-fine:hover:text-ink-muted"

/**
 * Link tabs between routes. `aria-label` names the navigation landmark.
 * The current link carries `aria-current="page"` and the ink underline, and
 * is scrolled into view along the row on mount and on every route change.
 */
function TabNav({
  items,
  className,
  ...props
}: Omit<React.ComponentProps<"nav">, "children"> & { items: TabNavItem[] }) {
  const rowRef = React.useRef<HTMLUListElement>(null)
  useScrollFade(rowRef)
  const currentHref = items.find((item) => item.current)?.href
  useCurrentInView(rowRef, '[aria-current="page"]', currentHref)
  return (
    <nav data-slot="tab-nav" className={cn("min-w-0", className)} {...props}>
      <ul ref={rowRef} className={cn(tabsRowClassName, "list-none")}>
        {items.map((item) => {
          const reason = item.unavailableReason ? (
            <>
              <LockIcon aria-hidden className="size-3.5 text-ink-muted" />
              <span className="sr-only">
                {" "}
                (unavailable: {item.unavailableReason})
              </span>
            </>
          ) : null
          const content = (
            <>
              <TabLabel label={item.label} shortLabel={item.shortLabel} />
              {reason}
              {item.badge}
            </>
          )
          return (
            <li key={item.href} className="flex shrink-0">
              {item.disabled && !item.current ? (
                // No href: not focusable, not followable. The explicit role
                // keeps it announced as a (disabled) link among its siblings.
                <a
                  role="link"
                  aria-disabled="true"
                  data-disabled=""
                  data-unavailable={item.unavailableReason ? true : undefined}
                  title={item.unavailableReason ?? undefined}
                  className={cn(tabItemClassName, disabledTabClassName)}
                >
                  {content}
                </a>
              ) : (
                <Link
                  href={item.href}
                  aria-current={item.current ? "page" : undefined}
                  data-unavailable={item.unavailableReason ? true : undefined}
                  title={item.unavailableReason ?? undefined}
                  className={cn(
                    tabItemClassName,
                    item.unavailableReason && "font-normal"
                  )}
                >
                  {content}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export {
  Tabs,
  TabsList,
  TabsTab,
  TabsPanel,
  TabNav,
  TabLabel,
  tabItemClassName,
  tabsRowClassName,
}
