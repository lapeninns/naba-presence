"use client"

import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { CheckIcon, ChevronRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function DropdownMenu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}
function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

type PositionProps = Pick<
  MenuPrimitive.Positioner.Props,
  "side" | "align" | "sideOffset" | "alignOffset"
>

/**
 * The popup (reference `.menu`): surface, hairline edge, 10px radius, pop
 * shadow, 6px inset, at least 200px wide (never wider than the viewport).
 */
const popupClassName =
  "flex max-h-[min(var(--available-height),32rem)] max-w-[calc(100vw-24px)] min-w-[200px] origin-(--transform-origin) flex-col gap-px overflow-y-auto rounded-[10px] border border-line bg-surface p-1.5 text-ink shadow-np-pop outline-none transition-[opacity,scale] duration-(--np-duration-overlay) ease-spring data-starting-style:scale-[0.98] data-starting-style:opacity-0 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:duration-(--np-duration-fast) data-ending-style:ease-standard"

function DropdownMenuContent({
  className,
  children,
  side,
  align = "end",
  sideOffset = 6,
  alignOffset,
  ...props
}: MenuPrimitive.Popup.Props & PositionProps) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className="z-50 outline-none"
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(popupClassName, className)}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

/**
 * A menu row (reference `.menu [role=menuitem]`): 32px (44px on coarse
 * pointers), the tag radius, label with an optional leading glyph and a
 * trailing shortcut. Highlight is the hover fill. Disabled rows stay
 * readable in muted ink so a reason under them can be read.
 */
const itemClassName =
  "group/item relative flex min-h-(--np-menu-item-h) cursor-default items-center gap-2.5 rounded-(--np-radius-tag) px-2.5 py-1 text-ui text-ink outline-none select-none pointer-coarse:min-h-(--np-touch) data-highlighted:bg-fill data-disabled:cursor-not-allowed data-disabled:text-ink-muted [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:text-ink-muted [&_svg]:[stroke-width:1.75] [&_svg:not([class*='size-'])]:size-4"

const destructiveItemClassName =
  "text-danger-ink data-highlighted:bg-danger-tint [&_svg]:text-danger-ink"

function CheckColumn({ children }: { children?: React.ReactNode }) {
  return (
    <span
      data-slot="dropdown-menu-check"
      aria-hidden="true"
      className="flex size-4 shrink-0 items-center justify-center"
    >
      {children}
    </span>
  )
}

function DropdownMenuItem({
  className,
  children,
  variant = "default",
  disabledReason,
  ...props
}: MenuPrimitive.Item.Props & {
  variant?: "default" | "destructive"
  /**
   * Why this action is unavailable. Disables the row (still focusable, so
   * the reason can be reached) and shows the reason as a caption line.
   */
  disabledReason?: React.ReactNode
}) {
  const reasonId = React.useId()
  const disabled = Boolean(props.disabled || disabledReason)
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        itemClassName,
        variant === "destructive" && destructiveItemClassName,
        disabledReason && "items-start py-1.5",
        className
      )}
      {...props}
      disabled={disabled}
      aria-describedby={disabledReason ? reasonId : props["aria-describedby"]}
    >
      {disabledReason ? (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2.5">{children}</span>
          <span id={reasonId} className="text-caption text-ink-muted">
            {disabledReason}
          </span>
        </span>
      ) : (
        children
      )}
    </MenuPrimitive.Item>
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: MenuPrimitive.CheckboxItem.Props) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(itemClassName, className)}
      {...props}
    >
      <CheckColumn>
        <MenuPrimitive.CheckboxItemIndicator className="flex">
          <CheckIcon className="size-4 text-accent-ink!" />
        </MenuPrimitive.CheckboxItemIndicator>
      </CheckColumn>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(itemClassName, className)}
      {...props}
    >
      <CheckColumn>
        <MenuPrimitive.RadioItemIndicator className="flex">
          <CheckIcon className="size-4 text-accent-ink!" />
        </MenuPrimitive.RadioItemIndicator>
      </CheckColumn>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuGroup(props: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuLabel({
  className,
  ...props
}: MenuPrimitive.GroupLabel.Props) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      className={cn("px-2.5 pt-1.5 pb-0.5 text-[11.5px] font-medium text-ink-muted", className)}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("mx-0.5 my-1 border-t border-line", className)}
      {...props}
    />
  )
}

/**
 * The trailing shortcut column. A `kbd` so it is announced as keys; it takes
 * the highlight colour with its row.
 */
function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto pl-4 font-mono text-[11px] text-ink-muted",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub(props: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(itemClassName, "data-popup-open:bg-fill", className)}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4 text-ink-muted" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  children,
  side = "inline-end",
  align = "start",
  sideOffset = 2,
  alignOffset = -4,
  ...props
}: MenuPrimitive.Popup.Props & PositionProps) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className="z-50 outline-none"
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-sub-content"
          className={cn(popupClassName, className)}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
