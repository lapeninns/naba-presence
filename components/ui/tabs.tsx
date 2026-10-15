"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { CheckIcon, ChevronDownIcon, LockIcon } from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { isZeroCount } from "@/components/ui/count-text"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useMediaQuery } from "@/lib/hooks/use-media-query"
import { mediaQuery } from "@/lib/ui/breakpoints"
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
 *
 * A tab is never narrower than `--np-touch` (44px) on touch, so a one-word
 * tab ("All") is still a target. A count of zero draws no figure
 * (`TabCount`, one rule with `ChipCount`).
 *
 * A long `TabNav` can opt into `overflow="more"`: at a desk, tabs that do
 * not fit move into a "More" menu rather than hiding behind a fade (a mouse
 * has no sideways swipe). The current tab always stays in the row; a phone
 * or tablet keeps scrolling.
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

/**
 * Focus is drawn INSIDE the tab (`focus-ring-inset`): the row scrolls
 * sideways (`overflow-x-auto`), so it clips everything outside its padding
 * box, and an outer halo would lose its bottom edge to the hairline and its
 * sides at either end of the row. Vertical padding cannot save the sides.
 *
 * One tab or tab link. The current one is `data-active` (a Base UI tab),
 * `aria-current="page"` (a route link) or `aria-current="location"` (a link
 * to a section of the same page, e.g. a profile's section nav).
 */
const tabItemClassName = cn(
  "relative inline-flex h-11 min-w-(--np-touch) shrink-0 items-center justify-center gap-1.5 rounded-t-(--np-radius-tag) px-3 text-ui font-medium whitespace-nowrap text-ink-muted no-underline focus-ring-inset transition-colors duration-(--np-duration-fast) ease-spring-snappy disabled:pointer-events-none disabled:opacity-50 hover-fine:hover:text-ink desk:h-10 desk:min-w-0",
  "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent after:content-['']",
  "aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:after:bg-ink data-active:font-semibold data-active:text-ink data-active:after:bg-ink",
  // An in-page section nav marks its current section `aria-current="location"`.
  "aria-[current=location]:font-semibold aria-[current=location]:text-ink aria-[current=location]:after:bg-ink",
  // A row of plain buttons (a queue switcher) marks its current one `aria-current="true"`.
  "aria-[current=true]:font-semibold aria-[current=true]:text-ink aria-[current=true]:after:bg-ink",
  "[&_svg]:shrink-0 [&_svg]:[stroke-width:1.75] [&_svg:not([class*='size-'])]:size-4"
)

/**
 * Text tabs (Notion Mail's queue tabs, brief §4.3): no track line, plain
 * labels in `text-body`. Others are `ink-secondary`; the current one is 600
 * `ink` with a 2px ink underline, a cue that does not rely on colour. A
 * count sits after the label in `text-count`. The row scrolls sideways with
 * a faded, clipped edge rather than squeezing a label.
 */
const textTabItemClassName = cn(
  "relative inline-flex h-11 min-w-(--np-touch) shrink-0 items-center justify-center gap-1.5 rounded-t-(--np-radius-tag) px-2 text-body font-normal whitespace-nowrap text-ink-secondary no-underline focus-ring-inset transition-colors duration-(--np-duration-fast) ease-spring-snappy disabled:pointer-events-none disabled:opacity-50 hover-fine:hover:text-ink desk:h-10 desk:min-w-0",
  "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent after:content-['']",
  "aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:after:bg-ink data-active:font-semibold data-active:text-ink data-active:after:bg-ink",
  // An in-page section nav marks its current section `aria-current="location"`.
  "aria-[current=location]:font-semibold aria-[current=location]:text-ink aria-[current=location]:after:bg-ink",
  // A row of plain buttons (a queue switcher) marks its current one `aria-current="true"`.
  "aria-[current=true]:font-semibold aria-[current=true]:text-ink aria-[current=true]:after:bg-ink",
  "[&_svg]:shrink-0 [&_svg]:[stroke-width:1.75] [&_svg:not([class*='size-'])]:size-4"
)

/** The text tabs' row: the same scrolling strip without the hairline. */
const textTabsRowClassName = cn(tabsRowClassName, "gap-0.5 border-b-0")

/**
 * A count after a text tab's label ("Needs reply 12"). A zero draws
 * nothing (see `isZeroCount`): one rule with `ChipCount`.
 */
function TabCount({ className, ...props }: React.ComponentProps<"span">) {
  if (isZeroCount(props.children)) return null
  return (
    <span
      data-slot="tab-count"
      className={cn(
        "text-count leading-none font-normal text-ink-muted tabular-nums",
        className
      )}
      {...props}
    />
  )
}

export type TabsVariant = "line" | "text"

const TabsVariantContext = React.createContext<TabsVariant>("line")

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
  variant = "line",
  ...props
}: TabsPrimitive.List.Props & {
  fill?: boolean
  /** `text`: Notion Mail text tabs (see `textTabItemClassName`). */
  variant?: TabsVariant
}) {
  const rowRef = React.useRef<HTMLDivElement>(null)
  useScrollFade(rowRef)
  useCurrentInView(rowRef, "[data-active]")
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.List
        ref={rowRef}
        data-slot="tabs-list"
        data-fill={fill || undefined}
        data-variant={variant === "line" ? undefined : variant}
        className={cn(
          variant === "text" ? textTabsRowClassName : tabsRowClassName,
          fill && FILL_CLASS,
          className
        )}
        {...props}
      >
        {children}
      </TabsPrimitive.List>
    </TabsVariantContext.Provider>
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
  const variant = React.useContext(TabsVariantContext)
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        variant === "text" ? textTabItemClassName : tabItemClassName,
        className
      )}
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
  /** A count after the label, drawn as a `TabCount`. */
  count?: React.ReactNode
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

/** The label, reason and count inside a tab, shared by every drawing of it. */
function TabNavContent({ item }: { item: TabNavItem }) {
  const reason = item.unavailableReason ? (
    <>
      <LockIcon aria-hidden className="size-3.5 text-ink-muted" />
      <span className="sr-only"> (unavailable: {item.unavailableReason})</span>
    </>
  ) : null
  return (
    <>
      <TabLabel label={item.label} shortLabel={item.shortLabel} />
      {reason}
      {item.count !== undefined &&
      item.count !== null &&
      !isZeroCount(item.count) ? (
        <>
          {/* A flex row drops this space from the drawing; it keeps
              the name "Needs reply 12", not "Needs reply12". */}{" "}
          <TabCount>{item.count}</TabCount>
        </>
      ) : null}
      {item.badge}
    </>
  )
}

/** Whether a tab is drawn as a dead (disabled) link rather than a link. */
const isDeadTab = (item: TabNavItem) => Boolean(item.disabled && !item.current)

function TabNavLink({
  item,
  itemClassName,
}: {
  item: TabNavItem
  itemClassName: string
}) {
  const content = <TabNavContent item={item} />
  return isDeadTab(item) ? (
    // No href: not focusable, not followable. The explicit role
    // keeps it announced as a (disabled) link among its siblings.
    <a
      role="link"
      aria-disabled="true"
      data-disabled=""
      data-unavailable={item.unavailableReason ? true : undefined}
      title={item.unavailableReason ?? undefined}
      className={cn(itemClassName, disabledTabClassName)}
    >
      {content}
    </a>
  ) : (
    <Link
      href={item.href}
      aria-current={item.current ? "page" : undefined}
      data-unavailable={item.unavailableReason ? true : undefined}
      title={item.unavailableReason ?? undefined}
      className={cn(itemClassName, item.unavailableReason && "font-normal")}
    >
      {content}
    </Link>
  )
}

/** The default row: every tab, scrolling sideways with a faded edge. */
function TabNavScrollRow({
  items,
  itemClassName,
  variant,
}: {
  items: TabNavItem[]
  itemClassName: string
  variant: TabsVariant
}) {
  const rowRef = React.useRef<HTMLUListElement>(null)
  useScrollFade(rowRef)
  const currentHref = items.find((item) => item.current)?.href
  useCurrentInView(rowRef, '[aria-current="page"]', currentHref)
  return (
    <ul
      ref={rowRef}
      className={cn(
        variant === "text" ? textTabsRowClassName : tabsRowClassName,
        "list-none"
      )}
    >
      {items.map((item) => (
        <li key={item.href} className="flex shrink-0">
          <TabNavLink item={item} itemClassName={itemClassName} />
        </li>
      ))}
    </ul>
  )
}

/** What the "More" row needs to know about the room it has. */
type StripLayout = {
  /** Each tab's width, in order. */
  widths: number[]
  /** The space between two tabs. */
  gap: number
  /** The "More" trigger's width. */
  more: number
  /** The width of the row. */
  available: number
}

/**
 * Which tabs stay in the row (true) and which go into "More" (false).
 * Everything stays when it all fits. Otherwise the row keeps the CURRENT
 * tab first, so the reader always sees where they are, then as many of the
 * others as fit in order, leaving room for the "More" trigger. The tabs
 * that stay are one unbroken run from the start, plus the current tab.
 */
function fitTabs(
  { widths, gap, more, available }: StripLayout,
  current: number
): boolean[] {
  const span = (sum: number, count: number) =>
    sum + gap * Math.max(0, count - 1)
  const total = span(
    widths.reduce((sum, width) => sum + width, 0),
    widths.length
  )
  // Not measured (a hidden or unlaid-out row) or it all fits.
  if (available <= 0 || total <= available + 0.5) return widths.map(() => true)
  const room = available - more - gap
  const visible = widths.map(() => false)
  let sum = 0
  let count = 0
  const take = (index: number) => {
    if (span(sum + widths[index], count + 1) > room) return false
    visible[index] = true
    sum += widths[index]
    count += 1
    return true
  }
  if (current >= 0) take(current)
  for (let index = 0; index < widths.length; index += 1) {
    if (visible[index]) continue
    if (!take(index)) break
  }
  return visible
}

/** Reads the room from the hidden measuring row (see `TabNavMoreRow`). */
function measureStrip(
  row: HTMLElement,
  ghost: HTMLElement
): StripLayout | null {
  const cells = Array.from(ghost.children)
  if (cells.length < 2) return null
  const boxes = cells.map((cell) => cell.getBoundingClientRect())
  const round = (value: number) => Math.round(value * 100) / 100
  const widths = boxes.slice(0, -1).map((box) => round(box.width))
  const gap =
    boxes.length > 2 ? Math.max(0, round(boxes[1].left - boxes[0].right)) : 0
  return {
    widths,
    gap,
    more: round(boxes[boxes.length - 1].width),
    available: round(row.getBoundingClientRect().width),
  }
}

const sameLayout = (a: StripLayout | null, b: StripLayout | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.gap === b.gap &&
    a.more === b.more &&
    a.available === b.available &&
    a.widths.length === b.widths.length &&
    a.widths.every((width, index) => width === b.widths[index]))

/**
 * The desk row for `overflow="more"`: the tabs that fit, then a "More"
 * menu holding the rest. Widths come from a hidden, inert copy of every tab
 * (`ghost`), so a tab that has moved into the menu can still be measured
 * and put back when there is room; the copy is clipped to a zero-height box
 * so it never widens the page. Until the first measure every tab is drawn
 * (the layout effect lands before the first paint).
 */
function TabNavMoreRow({
  items,
  itemClassName,
  variant,
  moreLabel,
}: {
  items: TabNavItem[]
  itemClassName: string
  variant: TabsVariant
  moreLabel: string
}) {
  const rowRef = React.useRef<HTMLUListElement>(null)
  const ghostRef = React.useRef<HTMLUListElement>(null)
  const [layout, setLayout] = React.useState<StripLayout | null>(null)
  const gapClassName = variant === "text" ? "gap-0.5" : "gap-1"

  const measure = React.useCallback(() => {
    const row = rowRef.current
    const ghost = ghostRef.current
    if (!row || !ghost) return
    const next = measureStrip(row, ghost)
    setLayout((previous) => (sameLayout(previous, next) ? previous : next))
  }, [])
  // After every render, so a count arriving or a label changing is measured
  // before it paints; `setLayout` only changes state when a number moved.
  React.useLayoutEffect(measure)
  React.useEffect(() => {
    const row = rowRef.current
    const ghost = ghostRef.current
    if (!row || !ghost || typeof ResizeObserver === "undefined") return
    // The row resizing (the window, the shell's sidebar) and a tab resizing
    // after mount (a late web font).
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    for (const cell of ghost.children) observer.observe(cell)
    return () => observer.disconnect()
  }, [measure, items.length])

  const currentIndex = items.findIndex((item) => item.current)
  const fits =
    layout && layout.widths.length === items.length
      ? fitTabs(layout, currentIndex)
      : null
  const shown = items.filter((_, index) => fits?.[index] ?? true)
  const overflow = items.filter((_, index) => fits !== null && !fits[index])
  const currentOverflow = overflow.find((item) => item.current)

  return (
    <div className="relative">
      <div
        aria-hidden
        inert
        data-slot="tab-nav-measure"
        className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
      >
        <ul
          ref={ghostRef}
          className={cn("flex w-max list-none items-end", gapClassName)}
        >
          {items.map((item) => (
            <li key={item.href} className="flex shrink-0">
              <span
                // Not `aria-current`: the copy must not add a second current
                // page to the nav. The attribute only makes it 600 weight.
                data-current={item.current ? "" : undefined}
                className={cn(
                  itemClassName,
                  "data-current:font-semibold",
                  isDeadTab(item)
                    ? disabledTabClassName
                    : item.unavailableReason && "font-normal"
                )}
              >
                <TabNavContent item={item} />
              </span>
            </li>
          ))}
          <li className="flex shrink-0">
            {/* Measured at 600, how it is drawn when it is the current tab. */}
            <span className={cn(itemClassName, "font-semibold")}>
              {moreLabel}
              <ChevronDownIcon aria-hidden />
            </span>
          </li>
        </ul>
      </div>
      <ul
        ref={rowRef}
        className={cn(
          "flex min-w-0 list-none items-end overflow-hidden",
          gapClassName,
          variant === "text" ? "border-b-0" : "border-b border-line"
        )}
      >
        {shown.map((item) => (
          <li key={item.href} className="flex shrink-0">
            <TabNavLink item={item} itemClassName={itemClassName} />
          </li>
        ))}
        {overflow.length > 0 ? (
          <li className="flex shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger
                data-slot="tab-nav-more"
                // The reader is on a page that lives in the menu: the
                // trigger takes the current tab's underline.
                aria-current={currentOverflow ? "page" : undefined}
                className={cn(
                  itemClassName,
                  "cursor-pointer data-popup-open:text-ink"
                )}
              >
                {moreLabel}
                {currentOverflow ? (
                  <span className="sr-only">
                    , current page: {currentOverflow.label}
                  </span>
                ) : null}
                <ChevronDownIcon aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" title={moreLabel}>
                {overflow.map((item) => (
                  <DropdownMenuItem
                    key={item.href}
                    disabled={isDeadTab(item)}
                    render={
                      isDeadTab(item) ? (
                        <a />
                      ) : (
                        <Link
                          href={item.href}
                          aria-current={item.current ? "page" : undefined}
                          data-unavailable={
                            item.unavailableReason ? true : undefined
                          }
                        />
                      )
                    }
                    className={cn(
                      item.unavailableReason && "items-start py-1.5"
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span
                        className={cn(
                          item.unavailableReason && "font-normal text-ink-muted"
                        )}
                      >
                        {item.label}
                      </span>
                      {item.unavailableReason ? (
                        <span className="text-caption text-ink-muted">
                          <span className="sr-only">Unavailable: </span>
                          {item.unavailableReason}
                        </span>
                      ) : null}
                    </span>
                    {item.count !== undefined && item.count !== null ? (
                      <TabCount>{item.count}</TabCount>
                    ) : null}
                    {item.badge}
                    {item.current ? <CheckIcon aria-hidden /> : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ) : null}
      </ul>
    </div>
  )
}

/**
 * Link tabs between routes. `aria-label` names the navigation landmark.
 * The current link carries `aria-current="page"` and the ink underline, and
 * is scrolled into view along the row on mount and on every route change.
 *
 * `overflow` chooses what a row too long for its width does:
 * - `"scroll"` (the default): scroll sideways with a faded edge, everywhere;
 * - `"more"`: scroll on a phone or tablet, but at a desk (a fine pointer at
 *   least `md` wide, where a mouse cannot swipe) keep the tabs that fit
 *   and put the rest in a "More" menu. The current tab always stays in the
 *   row; if there is no room even for it, the "More" trigger is drawn as
 *   current instead. The server and the first client render are the
 *   scrolling row, so there is no hydration mismatch.
 */
function TabNav({
  items,
  variant = "line",
  overflow = "scroll",
  moreLabel = "More",
  className,
  ...props
}: Omit<React.ComponentProps<"nav">, "children"> & {
  items: TabNavItem[]
  /** `text`: Notion Mail text tabs (see `textTabItemClassName`). */
  variant?: TabsVariant
  /** What a row too long for its width does at a desk (see above). */
  overflow?: "scroll" | "more"
  /** The overflow menu's trigger. Default "More". */
  moreLabel?: string
}) {
  const itemClassName =
    variant === "text" ? textTabItemClassName : tabItemClassName
  const desk = useMediaQuery(mediaQuery("desk"), false)
  return (
    <nav
      data-slot="tab-nav"
      data-variant={variant === "line" ? undefined : variant}
      className={cn("min-w-0", className)}
      {...props}
    >
      {overflow === "more" && desk ? (
        <TabNavMoreRow
          items={items}
          itemClassName={itemClassName}
          variant={variant}
          moreLabel={moreLabel}
        />
      ) : (
        <TabNavScrollRow
          items={items}
          itemClassName={itemClassName}
          variant={variant}
        />
      )}
    </nav>
  )
}

/**
 * Text tabs between routes (queue tabs, listing sections): `TabNav` drawn
 * as Notion Mail text tabs. The current link carries `aria-current="page"`.
 * For in-page tabs use `<TabsList variant="text">` (current tab is
 * `aria-selected`).
 */
function TextTabs(props: Omit<React.ComponentProps<typeof TabNav>, "variant">) {
  return <TabNav variant="text" {...props} />
}

export {
  Tabs,
  TabsList,
  TabsTab,
  TabsPanel,
  TabNav,
  TabLabel,
  TabCount,
  TextTabs,
  useScrollFade,
  tabItemClassName,
  tabsRowClassName,
  textTabItemClassName,
  textTabsRowClassName,
}
