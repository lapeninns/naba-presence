"use client"

import { Command as CommandPrimitive } from "cmdk"
import { SearchIcon } from "lucide-react"
import * as React from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"

/**
 * The command palette shell, over cmdk.
 *
 * cmdk owns the listbox semantics, the filtering and the arrow-key roving
 * focus; this file supplies the chrome: the popover material, a capsule
 * search field on top, grouped results under caption labels, and an
 * accent-tinted highlight (a palette is a list you scan, so it does not use
 * the solid menu highlight). The dialog keeps a real title and description,
 * visually hidden — a dialog with no accessible name is announced as an
 * unnamed region, which is precisely the state a keyboard user lands in when
 * they hit the shortcut.
 */
function CommandDialog({
  open,
  onOpenChange,
  title = "Search",
  description = "Find a client, a location or an action.",
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden rounded-(--np-radius-modal) border-0 bg-transparent p-0 shadow-(--np-shadow-modal) sm:max-w-xl"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command className="material-popover">{children}</Command>
      </DialogContent>
    </Dialog>
  )
}

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn("flex w-full flex-col overflow-hidden text-ink", className)}
      {...props}
    />
  )
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="border-b border-line-subtle p-2">
      <div
        data-slot="command-search"
        className={cn(
          "flex h-(--np-field-h) items-center gap-2 rounded-(--np-radius-pill) bg-fill-secondary px-3",
          "transition-[box-shadow] duration-(--np-duration-fast) ease-spring-snappy focus-within:[box-shadow:var(--np-focus-halo)]"
        )}
      >
        <SearchIcon
          className="size-4 shrink-0 text-ink-muted"
          strokeWidth={1.75}
          aria-hidden
        />
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            "h-full w-full min-w-0 bg-transparent text-body text-ink outline-none placeholder:text-ink-muted",
            className
          )}
          {...props}
        />
      </div>
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "max-h-80 overflow-x-hidden overflow-y-auto p-1",
        className
      )}
      {...props}
    />
  )
}

function CommandEmpty(
  props: React.ComponentProps<typeof CommandPrimitive.Empty>
) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="px-4 py-8 text-center text-ui text-ink-muted"
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-ink [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-muted",
        className
      )}
      {...props}
    />
  )
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "flex min-h-(--np-menu-item-h) cursor-default items-center gap-2.5 rounded-(--np-radius-control) px-2.5 py-1.5 text-ui text-ink outline-none select-none",
        "transition-[background-color,color] duration-(--np-duration-fast) ease-spring-snappy",
        "data-[selected=true]:bg-accent-tint data-[selected=true]:text-accent-ink",
        "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

/**
 * A trailing keyboard hint for a palette row, in the keycap style. Reads as
 * a key to a screen reader, and stays legible when the row is highlighted.
 */
function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<typeof Kbd>) {
  return (
    <Kbd
      data-slot="command-shortcut"
      className={cn("ml-auto shrink-0", className)}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("mx-2 my-1 h-px bg-line-subtle", className)}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
}
