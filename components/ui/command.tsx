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
 * focus; this file supplies the chrome (reference `.palette`): a 620px
 * panel 12vh from the top, a borderless title-size search row over a
 * hairline, mono uppercase group labels, rows that take the accent tint when
 * selected, and an optional footer of key hints (`footer` / `CommandFooter`). The dialog keeps a real title and description,
 * visually hidden — a dialog with no accessible name is announced as an
 * unnamed region, which is precisely the state a keyboard user lands in when
 * they hit the shortcut.
 */
function CommandDialog({
  open,
  onOpenChange,
  title = "Search",
  description = "Find a client, a location or an action.",
  footer,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  /** Key hints under the list, e.g. `<CommandFooter>`. */
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[12vh] block w-[min(620px,calc(100vw-24px))] max-w-none translate-y-0 gap-0 overflow-hidden p-0 data-starting-style:translate-y-2 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command className="bg-surface">{children}</Command>
        {footer}
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
    <div
      data-slot="command-search"
      className="flex items-center gap-2.5 border-b border-line px-[18px]"
    >
      <SearchIcon
        className="size-4 shrink-0 text-ink-muted"
        strokeWidth={1.75}
        aria-hidden
      />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "h-14 w-full min-w-0 bg-transparent text-title text-ink outline-none placeholder:text-ink-muted",
          className
        )}
        {...props}
      />
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
        "max-h-[50vh] overflow-x-hidden overflow-y-auto overscroll-contain p-1.5",
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
        "overflow-hidden text-ink [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:tracking-[0.04em] [&_[cmdk-group-heading]]:text-ink-muted [&_[cmdk-group-heading]]:uppercase",
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
        "flex min-h-9 cursor-default items-center gap-2.5 rounded-(--np-radius-control) px-3 py-2 text-body text-ink outline-none select-none pointer-coarse:min-h-(--np-touch) [&_svg]:text-ink-muted data-[selected=true]:[&_svg]:text-accent-ink",
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

/** Key hints under the palette (reference `.palette-foot`). */
function CommandFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="command-footer"
      className={cn(
        "flex flex-wrap gap-x-4 gap-y-1 border-t border-line bg-surface px-4 py-2.5 text-caption text-ink-muted max-sm:hidden",
        className
      )}
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
      className={cn("mx-1 my-1 h-px bg-line", className)}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
}
