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
        "relative w-px shrink-0 bg-line transition-colors duration-(--np-duration-fast) after:absolute after:inset-y-0 after:-left-1 after:w-2 after:content-[''] hover:bg-[var(--np-line-strong)] focus-visible:bg-[var(--np-accent)] focus-visible:outline-none",
        className
      )}
      {...props}
    />
  )
}

export { SplitPane, SplitPaneHandle, SplitPanePanel }
