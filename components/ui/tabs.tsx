"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@/lib/utils"

/**
 * Tabs for genuinely separate page sections: a row of labels over a hairline,
 * with a 2px accent underline that slides to the active one. Switching views
 * of the same data is SegmentedControl's job, so nothing here looks like a
 * track with a thumb.
 */
function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  )
}

function TabsList({ className, children, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        // Horizontal padding matches the tabs' own inset so the focus halo is
        // not clipped by the scroll container; the row's bottom hairline is
        // the underline's track.
        "relative -mx-1 flex items-end gap-5 overflow-x-auto border-b border-line-subtle px-1 pt-1",
        className
      )}
      {...props}
    >
      {children}
      <TabsPrimitive.Indicator
        data-slot="tabs-indicator"
        className="absolute -bottom-px left-0 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) rounded-(--np-radius-pill) bg-primary transition-[translate,width] duration-(--np-duration-standard) ease-spring-snappy"
      />
    </TabsPrimitive.List>
  )
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        "focus-halo mb-1.5 inline-flex h-(--np-control-h) shrink-0 items-center gap-1.5 rounded-(--np-radius-tag) px-1 text-ui font-medium whitespace-nowrap text-ink-muted transition-colors duration-(--np-duration-fast) ease-spring-snappy hover:text-ink disabled:pointer-events-none disabled:text-ink-faint data-active:text-ink [&_svg]:shrink-0 [&_svg]:[stroke-width:1.75] [&_svg:not([class*='size-'])]:size-4",
        className
      )}
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

export { Tabs, TabsList, TabsTab, TabsPanel }
