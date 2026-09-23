"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
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

/** The row: a hairline track that scrolls sideways without a scrollbar. */
const tabsRowClassName =
  "relative flex min-w-0 items-end gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"

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
  return (
    <TabsPrimitive.List
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
  return (
    <nav data-slot="tab-nav" className={cn("min-w-0", className)} {...props}>
      <ul className={cn(tabsRowClassName, "list-none")}>
        {items.map((item) => (
          <li key={item.href} className="flex shrink-0">
            <Link
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              className={tabItemClassName}
            >
              {item.label}
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
