"use client"

import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { CheckIcon, ChevronRightIcon } from "lucide-react"

import {
  MenuCloseProvider,
  MenuSheetCancel,
  MenuSheetTitle,
  menuGroupLabelClassName,
  menuRowClassName,
  menuSeparatorClassName,
  menuSheetListClassName,
  menuSheetPopupClassName,
  menuSheetPositionerClassName,
  menuSheetScrimClassName,
  useMenuActions,
  useMenuSheet,
} from "@/components/ui/menu-surface"
import { cn } from "@/lib/utils"

/**
 * An action menu. A floating panel by its trigger on the desk; a bottom
 * action sheet on a phone, with an optional `title` on the content and a
 * Cancel under the rows (see menu-surface).
 */
function DropdownMenu({ actionsRef, ...props }: MenuPrimitive.Root.Props) {
  const { actions, close } = useMenuActions(actionsRef)
  return (
    <MenuCloseProvider close={close}>
      <MenuPrimitive.Root
        data-slot="dropdown-menu"
        actionsRef={actions}
        {...props}
      />
    </MenuCloseProvider>
  )
}
function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

type PositionProps = Pick<
  MenuPrimitive.Positioner.Props,
  "side" | "align" | "sideOffset" | "alignOffset"
>

/**
 * The floating popup (reference `.menu`): surface, hairline edge, 10px
 * radius, pop shadow, 6px inset, at least 200px wide (never wider than the
 * viewport).
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
  title,
  ...props
}: MenuPrimitive.Popup.Props &
  PositionProps & {
    /** A heading for the phone's action sheet ("Reply actions"). */
    title?: React.ReactNode
  }) {
  const sheet = useMenuSheet()
  if (sheet) {
    // `Menu.List` takes the menu role, leaving the title and Cancel outside
    // the menu's rows. The desk placement props have nothing to place.
    return (
      <MenuPrimitive.Portal>
        <MenuPrimitive.Backdrop className={menuSheetScrimClassName} />
        <MenuPrimitive.Positioner className={menuSheetPositionerClassName}>
          <MenuPrimitive.Popup
            data-slot="dropdown-menu-content"
            data-presentation="sheet"
            className={cn(menuSheetPopupClassName, className)}
            {...props}
          >
            {title ? <MenuSheetTitle>{title}</MenuSheetTitle> : null}
            <MenuPrimitive.List
              className={cn(menuSheetListClassName, "flex flex-col gap-px")}
            >
              {children}
            </MenuPrimitive.List>
            <MenuSheetCancel />
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    )
  }
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className="z-popover outline-none"
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          data-presentation="popover"
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
 * A menu row (reference `.menu [role=menuitem]`): the shared menu row with
 * a muted leading glyph and a trailing shortcut. Disabled rows stay
 * focusable and readable so a reason under them can be read.
 */
const itemClassName = cn(
  menuRowClassName,
  "data-disabled:cursor-not-allowed [&_svg]:text-ink-muted [&_svg]:[stroke-width:1.75]"
)

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
      className={cn(menuGroupLabelClassName, className)}
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
      className={cn(menuSeparatorClassName, className)}
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
        "ml-auto pl-4 font-mono text-caption text-ink-muted",
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
        className="z-popover outline-none"
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
