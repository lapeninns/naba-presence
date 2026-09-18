"use client"

import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"

import { useFieldTriggerProps } from "@/components/ui/field"
import { cn } from "@/lib/utils"

/**
 * The pop-up button. The trigger is a grey control (the fill ladder, not a
 * bordered field) with the up-down chevron glyph; the popup is a menu on the
 * popover material with a checkmark column and the solid accent highlight.
 */
function Select<Value>(props: SelectPrimitive.Root.Props<Value>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

/** Shared by SelectTrigger and the Combobox trigger so both read as one control. */
export const selectTriggerClassName = cn(
  "inline-flex h-(--np-control-h) min-w-0 cursor-default items-center justify-between gap-2 rounded-(--np-radius-control) bg-fill px-3 text-ui text-ink focus-halo select-none",
  "transition-[background-color,transform] duration-(--np-duration-fast) ease-spring-snappy",
  "hover:bg-fill-secondary active:scale-[0.98] data-popup-open:bg-fill-secondary",
  "disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50",
  "aria-invalid:[box-shadow:0_0_0_0.5px_var(--np-danger-line)]",
  "[&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:whitespace-nowrap",
  "[&_[data-slot=select-value][data-placeholder]]:text-ink-muted"
)

/**
 * Inside a `Field` the trigger takes the Field's id, its invalid state, its
 * description/error wiring and — unless the caller names it itself — the
 * Field's label. A pop-up button is not a labelable element, so this is the
 * only way a `FieldLabel` can reach it; see `useFieldTriggerProps`.
 */
function SelectTrigger({
  className,
  children,
  ...props
}: SelectPrimitive.Trigger.Props) {
  const fieldProps = useFieldTriggerProps({
    hasOwnName:
      props["aria-label"] !== undefined ||
      props["aria-labelledby"] !== undefined,
  })
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(selectTriggerClassName, className)}
      {...fieldProps}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        data-slot="select-icon"
        className="flex shrink-0 items-center text-ink-muted"
      >
        <ChevronsUpDownIcon className="size-4" strokeWidth={1.75} aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectValue(props: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

/**
 * The menu popup recipe shared with Combobox and DropdownMenu-style popups:
 * popover material, card radius, the pop shadow, and a spring from the
 * trigger side. Base UI's Select aligns the popup with the trigger item by
 * default (`data-side="none"`), in which case nothing scales — the menu
 * simply appears over the trigger, as on the platform.
 */
export const menuPopupClassName = cn(
  "rounded-(--np-radius-card) material-popover p-1 text-ink shadow-(--np-shadow-pop) outline-none",
  "origin-(--transform-origin) transition-[transform,opacity] duration-(--np-duration-overlay) ease-spring",
  "data-ending-style:scale-[0.96] data-ending-style:opacity-0 data-starting-style:scale-[0.96] data-starting-style:opacity-0",
  "data-[side=none]:data-starting-style:scale-100 data-[side=none]:data-starting-style:opacity-100 data-[side=none]:data-starting-style:transition-none"
)

/** A menu row: 30px, tag radius, checkmark column, solid accent when highlighted. */
export const menuItemClassName = cn(
  "relative flex h-(--np-menu-item-h) cursor-default items-center gap-2 rounded-(--np-radius-tag) py-0 pr-2 pl-7 text-ui text-ink outline-none select-none",
  "data-highlighted:bg-primary data-highlighted:text-primary-foreground",
  "data-disabled:pointer-events-none data-disabled:opacity-50",
  "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
)

function SelectContent({
  className,
  children,
  alignItemWithTrigger = true,
  ...props
}: SelectPrimitive.Popup.Props & {
  /**
   * Base UI's default puts the popup ON the trigger, with the chosen item over
   * it — the platform behaviour, and right for a select standing on its own.
   *
   * Pass `false` for a control in a toolbar that sits directly above content:
   * an overlaying menu covers the thing the operator is filtering, and while
   * that content is still laying out the menu lands somewhere neither of them
   * agreed on. Dropping it below the control keeps it clear of both.
   */
  alignItemWithTrigger?: boolean
}) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        sideOffset={6}
        alignItemWithTrigger={alignItemWithTrigger}
        className="z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            menuPopupClassName,
            "max-h-[min(24rem,var(--available-height))] min-w-[var(--anchor-width)] overflow-y-auto",
            className
          )}
          {...props}
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(menuItemClassName, className)}
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex items-center">
        <CheckIcon className="size-4" strokeWidth={2} aria-hidden />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate">
        {children}
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectGroup(props: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectGroupLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-group-label"
      className={cn(
        "px-2 py-1.5 text-caption font-medium text-ink-muted",
        className
      )}
      {...props}
    />
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("mx-2 my-1 h-px bg-line-subtle", className)}
      {...props}
    />
  )
}

export {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectGroupLabel,
  SelectSeparator,
}
