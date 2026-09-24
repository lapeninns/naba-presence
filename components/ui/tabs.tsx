"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { LockIcon } from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Tabs for genuinely separate page sections (reference `.tabs`): a row of
 * 40px labels over a hairline, muted until selected, with a 2px INK
 * underline inset 8px from the tab's edges. The row scrolls sideways when it
 * does not fit. Switching views of the same data is SegmentedControl's job.
 *
 * `TabNav` is the same drawing for tabs that are links between routes
 * (`aria-current="page"` rather than a tablist), such as a listing's areas.
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
  "relative flex min-w-0 items-end gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
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

/** One tab or tab link. */
const tabItemClassName = cn(
  "relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-t-(--np-radius-tag) px-3 text-ui font-medium whitespace-nowrap text-ink-muted no-underline focus-halo transition-colors duration-(--np-duration-fast) ease-spring-snappy hover:text-ink disabled:pointer-events-none disabled:opacity-50 pointer-coarse:h-11",
  "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-[2px] after:bg-transparent after:content-['']",
  "aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:after:bg-ink data-active:font-semibold data-active:text-ink data-active:after:bg-ink",
  "[&_svg]:shrink-0 [&_svg]:[stroke-width:1.75] [&_svg:not([class*='size-'])]:size-4"
)

/**
 * `fill` is the phone drawing of a short tab row: equal columns that divide
 * the width, rather than a scrolling strip. From `sm` it returns to the row.
 */
const FILL_CLASS = cn(
  "grid auto-cols-fr grid-flow-col gap-0",
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

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(tabItemClassName, className)}
      {...props}
    />
  )
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn("outline-none", className)}
      {...props}
    />
  )
}

export type TabNavItem = {
  href: string
  label: React.ReactNode
  current?: boolean
  /** A count or badge after the label. */
  badge?: React.ReactNode
  /**
   * Why this tab's section can't be used right now. The link still works
   * (the page explains more), but it is drawn muted and the reason is
   * given as its description.
   */
  unavailableReason?: string | null
}

/**
 * Link tabs between routes. `aria-label` names the navigation landmark.
 * The current link carries `aria-current="page"` and the ink underline.
 */
function TabNav({
  items,
  className,
  ...props
}: Omit<React.ComponentProps<"nav">, "children"> & { items: TabNavItem[] }) {
  const rowRef = React.useRef<HTMLUListElement>(null)
  useScrollFade(rowRef)
  return (
    <nav data-slot="tab-nav" className={cn("min-w-0", className)} {...props}>
      <ul ref={rowRef} className={cn(tabsRowClassName, "list-none")}>
        {items.map((item) => (
          <li key={item.href} className="flex shrink-0">
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
              {item.label}
              {item.unavailableReason ? (
                <LockIcon aria-hidden className="size-3.5 text-ink-muted" />
              ) : null}
              {item.unavailableReason ? (
                <span className="sr-only">
                  {" "}
                  (unavailable: {item.unavailableReason})
                </span>
              ) : null}
              {item.badge}
            </Link>
          </li>
        ))}
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
  tabItemClassName,
  tabsRowClassName,
}
