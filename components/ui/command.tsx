"use client"

import { Command as CommandPrimitive } from "cmdk"
import { SearchIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { OverlayGrabber, useOverlayPresentation } from "@/components/ui/overlay"
import { cn } from "@/lib/utils"

/**
 * The command palette shell, over cmdk.
 *
 * cmdk owns the listbox semantics, the filtering and the arrow-key roving
 * focus; this file supplies the chrome (reference `.palette`): a 620px
 * panel 12vh from the top, a borderless title-size search row over a
 * hairline, sentence-case group labels (D8), rows that take the accent tint
 * when selected, and an optional footer of key hints (`footer` /
 * `CommandFooter`). The dialog keeps a real title and description, visually
 * hidden — a dialog with no accessible name is announced as an unnamed
 * region, which is precisely the state a keyboard user lands in when they
 * hit the shortcut.
 *
 * On a phone (`phone`):
 *
 *   sheet     (the default) a full-height bottom sheet, chosen when the
 *             palette opens (see `useOverlayPresentation`)
 *   takeover  Notion Mail's search takeover (brief §1.6): the whole screen,
 *             a pill search field with a text "Cancel" beside it, results
 *             under it. Switched by CSS below `sm`, not by a media query in
 *             script, so the server's markup is right at every width and the
 *             desk palette is exactly the dialog above.
 */
const CommandTakeoverContext = React.createContext<{
  cancelLabel: string
} | null>(null)

function CommandDialog({
  open,
  onOpenChange,
  title = "Search",
  description = "Find a client, a location or an action.",
  footer,
  phone = "sheet",
  cancelLabel = "Cancel",
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  /** Key hints under the list, e.g. `<CommandFooter>`. */
  footer?: React.ReactNode
  /** The phone drawing: `sheet` (default) or the full-screen `takeover`. */
  phone?: "sheet" | "takeover"
  /** The takeover's Cancel, beside the field on a phone. */
  cancelLabel?: string
  children: React.ReactNode
}) {
  const presentation = useOverlayPresentation("auto", open)
  const takeover = React.useMemo(() => ({ cancelLabel }), [cancelLabel])
  if (phone === "takeover") {
    // One element at every width: the desk dialog's classes, and below `sm`
    // the full screen (inset 0, no radius, no shadow, under the status bar)
    // where it fades in rather than rising. The results run between the
    // field and the keyboard (`--np-dock-bottom`).
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          presentation="dialog"
          showCloseButton={false}
          data-phone="takeover"
          className={cn(
            DESK_PALETTE_CLASS,
            "max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:flex max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:translate-x-0 max-sm:flex-col max-sm:rounded-none max-sm:pt-safe max-sm:shadow-none max-sm:data-starting-style:translate-y-0 max-sm:data-starting-style:scale-100"
          )}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {description}
          </DialogDescription>
          <CommandTakeoverContext.Provider value={takeover}>
            <Command className="bg-surface max-sm:min-h-0 max-sm:flex-1 max-sm:[&_[data-slot=command-list]]:max-h-none max-sm:[&_[data-slot=command-list]]:min-h-0 max-sm:[&_[data-slot=command-list]]:flex-1 max-sm:[&_[data-slot=command-list]]:pb-[calc(--spacing(2)+var(--np-dock-bottom))]">
              {children}
            </Command>
          </CommandTakeoverContext.Provider>
          {footer}
        </DialogContent>
      </Dialog>
    )
  }
  if (presentation === "sheet") {
    // On a phone the palette is a full-height sheet: the search row pinned
    // under the drag handle, the results scrolling between it and the
    // keyboard (the list's bottom padding is the keyboard's height). Cancel
    // is the button alternative to the swipe; key hints have no keys here.
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          presentation="sheet"
          showCloseButton={false}
          className="flex h-[calc(100dvh-var(--np-safe-top)-0.75rem)] flex-col gap-0 overflow-hidden p-0"
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {description}
          </DialogDescription>
          <div className="relative flex h-11 shrink-0 items-start">
            <OverlayGrabber />
            <DialogClose
              render={
                <Button
                  variant="link"
                  className="absolute top-1.5 right-4 h-8! text-ui no-underline"
                />
              }
            >
              Cancel
            </DialogClose>
          </div>
          <Command className="min-h-0 flex-1 bg-surface [&_[data-slot=command-list]]:max-h-none [&_[data-slot=command-list]]:min-h-0 [&_[data-slot=command-list]]:flex-1 [&_[data-slot=command-list]]:pb-[calc(--spacing(2)+var(--overlay-dock,0px))]">
            {children}
          </Command>
        </DialogContent>
      </Dialog>
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        presentation="dialog"
        showCloseButton={false}
        className={DESK_PALETTE_CLASS}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command className="bg-surface">{children}</Command>
        {footer}
      </DialogContent>
    </Dialog>
  )
}

/** The desk palette: 620px, 12vh from the top, settling 8px as it fades in. */
const DESK_PALETTE_CLASS =
  "top-[12vh] block w-[min(620px,calc(100vw-24px))] max-w-none translate-y-0 gap-0 overflow-hidden p-0 data-starting-style:translate-y-2 sm:max-w-none"

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
  wrapperClassName,
  trailing,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & {
  /** Classes for the search row around the field (icon, field, trailing). */
  wrapperClassName?: string
  /** After the field, inside the row: a clear button, a spinner. */
  trailing?: React.ReactNode
}) {
  const takeover = React.useContext(CommandTakeoverContext)
  const row = (
    <div
      data-slot="command-search"
      className={cn(
        "flex items-center gap-2.5 border-b border-line px-[18px]",
        // The takeover's phone field: a 40px pill on the secondary fill.
        takeover &&
          "max-sm:h-(--np-touch) max-sm:min-w-0 max-sm:flex-1 max-sm:gap-2 max-sm:rounded-pill max-sm:border-b-0 max-sm:bg-fill-secondary max-sm:px-3",
        wrapperClassName
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
          // A placeholder too long for a narrow field ends in an ellipsis
          // rather than being cut mid-word (FINAL-QA #14).
          "h-14 w-full min-w-0 bg-transparent text-title text-ellipsis text-ink outline-none placeholder:text-ink-muted",
          takeover && "max-sm:h-(--np-touch)",
          className,
          // iOS zooms the page into a focused field under 16px; no caller
          // className may take a touch search field below that.
          "pointer-coarse:text-base!"
        )}
        {...props}
      />
      {trailing}
    </div>
  )
  if (!takeover) return row
  // From `sm` the bar is `display: contents` and its Cancel is hidden, so
  // the desk search row is the plain one above.
  return (
    <div
      data-slot="command-takeover-bar"
      className="flex shrink-0 items-center gap-1 py-2 pr-1 pl-(--np-page-pad-x) sm:contents"
    >
      {row}
      <DialogClose
        render={
          <Button
            variant="ghost"
            className="shrink-0 px-2.5 text-body font-normal text-accent-ink sm:hidden"
          />
        }
      >
        {takeover.cancelLabel}
      </DialogClose>
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
        // D8: a sentence-case label, caption size, medium, muted ink.
        "overflow-hidden text-ink [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-muted",
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
