"use client"

import * as React from "react"
import { Group, Panel, Separator } from "react-resizable-panels"

import { cn } from "@/lib/utils"

/**
 * Resizable panes for the inbox workspace.
 *
 * Wraps react-resizable-panels (v4: Group / Panel / Separator) so the handle
 * gets a real accessible name and the product's own focus treatment; the
 * library already provides the separator semantics and keyboard resizing.
 *
 * Nothing here renders a landmark. The inbox's own panes carry `nav` and
 * `section` labels, and a second `main` would break the pinned
 * `landmark-no-duplicate-main` rule.
 */
function SplitPane({ className, ...props }: React.ComponentProps<typeof Group>) {
  return (
    <Group
      data-slot="split-pane"
      className={cn("flex min-h-0 w-full", className)}
      {...props}
    />
  )
}

function SplitPanePanel({
  className,
  ...props
}: React.ComponentProps<typeof Panel>) {
  return (
    <Panel
      data-slot="split-pane-panel"
      className={cn("flex min-w-0 flex-col", className)}
      {...props}
    />
  )
}

/**
 * `label` names what the handle resizes ("Resize the review list"), because
 * "separator" alone tells a screen-reader user nothing about which pane moves.
 *
 * Visually a 1px hairline. The `after` pseudo-element is the real hit area,
 * 16px wide and invisible, so the line can stay thin without being hard to
 * grab. The library writes `data-separator="active"` while a drag is in
 * progress and `"focus"` while it has keyboard focus; both light the line in
 * the vivid accent and add the focus halo as a soft glow.
 */
function SplitPaneHandle({
  label,
  className,
  ...props
}: React.ComponentProps<typeof Separator> & { label: string }) {
  return (
    <Separator
      data-slot="split-pane-handle"
      aria-label={label}
      className={cn(
        "relative shrink-0 bg-line-subtle outline-none transition-[background-color,box-shadow] duration-(--np-duration-fast) ease-spring-snappy",
        // Side-by-side panes: a vertical line with a horizontal hit area.
        "aria-[orientation=vertical]:w-px aria-[orientation=vertical]:after:inset-y-0 aria-[orientation=vertical]:after:-left-2 aria-[orientation=vertical]:after:w-4",
        // Stacked panes: a horizontal line with a vertical hit area.
        "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:-top-2 aria-[orientation=horizontal]:after:h-4",
        "after:absolute after:content-['']",
        "data-[separator=hover]:bg-line-strong",
        "data-[separator=active]:bg-(--np-accent-vivid) data-[separator=active]:[box-shadow:var(--np-focus-halo)]",
        "data-[separator=focus]:bg-(--np-accent-vivid) data-[separator=focus]:[box-shadow:var(--np-focus-halo)]",
        "data-[separator=disabled]:cursor-default data-[separator=disabled]:bg-line-subtle",
        className
      )}
      {...props}
    />
  )
}

export { SplitPane, SplitPaneHandle, SplitPanePanel }
