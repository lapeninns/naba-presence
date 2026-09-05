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
 * The popup: on the popover material, scaling out of its anchor on the
 * spring. `--transform-origin` is set by the positioner from the resolved
 * side, so the menu grows from the trigger even after a collision flip.
 */
const popupClassName =
  "material-popover max-h-[min(var(--available-height),32rem)] min-w-48 origin-(--transform-origin) overflow-y-auto rounded-(--np-radius-card) p-1 text-ink shadow-(--np-shadow-pop) outline-none transition-[opacity,scale] duration-(--np-duration-overlay) ease-spring data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-96 data-ending-style:opacity-0 data-ending-style:duration-(--np-duration-fast) data-ending-style:ease-standard"

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
 * The Mac menu row: 30px tall, a reserved checkmark column on the left, the
 * label, and an optional shortcut on the right. Highlight is the accent fill
 * with white text — nothing else in the system highlights this way, which is
 * what makes a menu read as a menu.
 */
const itemClassName =
  "group/item relative flex h-(--np-menu-item-h) cursor-default items-center gap-2 rounded-(--np-radius-tag) px-2 text-ui text-ink outline-none select-none data-highlighted:bg-primary data-highlighted:text-primary-foreground data-disabled:pointer-events-none data-disabled:text-ink-faint [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:[stroke-width:1.75] [&_svg:not([class*='size-'])]:size-4"

const destructiveItemClassName =
  "text-danger-ink data-highlighted:bg-(--np-danger-solid) data-highlighted:text-(--np-danger-on-solid)"

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
  ...props
}: MenuPrimitive.Item.Props & { variant?: "default" | "destructive" }) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        itemClassName,
        variant === "destructive" && destructiveItemClassName,
        className
      )}
      {...props}
    >
      <CheckColumn />
      {children}
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
          <CheckIcon className="size-4" />
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
          <CheckIcon className="size-4" />
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
      className={cn("px-2 py-1.5 text-caption font-medium text-ink-muted", className)}
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
      className={cn("mx-2 my-1 border-t border-line-subtle", className)}
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
        "ml-auto pl-4 font-sans text-caption text-ink-muted group-data-highlighted/item:text-primary-foreground",
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
      <CheckColumn />
      {children}
      <ChevronRightIcon className="ml-auto size-4 text-ink-muted group-data-highlighted/item:text-primary-foreground" />
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
