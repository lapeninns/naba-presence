"use client"

import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

import { useFieldTriggerProps } from "@/components/ui/field"
import { cn } from "@/lib/utils"

/**
 * The pop-up button (reference `.select`). The trigger is drawn as a field:
 * white, the 3:1 control edge, a caret on the right, the accent edge and
 * halo while open or focused. The popup is the reference `.menu`: white,
 * hairline edge, pop shadow, rows that highlight on the hover fill, and a
 * checkmark column for the chosen value.
 */
function Select<Value>(props: SelectPrimitive.Root.Props<Value>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

/** Shared by SelectTrigger and the Combobox trigger so both read as one control. */
export const selectTriggerClassName = cn(
  "inline-flex h-(--np-field-h) min-w-0 cursor-default items-center justify-between gap-2 rounded-(--np-radius-field) border border-line-strong bg-(--np-field-bg) pr-2.5 pl-[11px] text-body text-ink outline-none select-none",
  "transition-[border-color,box-shadow] duration-(--np-duration-fast) ease-spring-snappy",
  "hover:border-ink-muted focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--np-accent-tint)] data-popup-open:border-primary data-popup-open:shadow-[0_0_0_3px_var(--np-accent-tint)]",
  "disabled:cursor-not-allowed disabled:bg-surface-alt disabled:text-ink-muted data-disabled:cursor-not-allowed data-disabled:bg-surface-alt data-disabled:text-ink-muted",
  "aria-invalid:border-danger-ink aria-invalid:shadow-[0_0_0_3px_var(--np-danger-tint)]",
  "pointer-coarse:text-base",
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
        <ChevronDownIcon className="size-4" strokeWidth={1.75} aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectValue(props: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

/**
 * The menu popup recipe shared with Combobox (reference `.menu`): surface,
 * hairline edge, 10px radius, pop shadow, 6px inset. Base UI's Select aligns
 * the popup with the trigger item by default (`data-side="none"`), in which
 * case nothing scales — the menu simply appears over the trigger.
 */
export const menuPopupClassName = cn(
  "rounded-[10px] border border-line bg-surface p-1.5 text-ink shadow-np-pop outline-none",
  "origin-(--transform-origin) transition-[transform,opacity] duration-(--np-duration-overlay) ease-spring",
  "data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0",
  "data-[side=none]:data-starting-style:scale-100 data-[side=none]:data-starting-style:opacity-100 data-[side=none]:data-starting-style:transition-none"
)

/** A menu row: 32px, tag radius, checkmark column, the hover fill when highlighted. */
export const menuItemClassName = cn(
  "relative flex min-h-(--np-menu-item-h) cursor-default items-center gap-2 rounded-(--np-radius-tag) py-1 pr-2.5 pl-8 text-ui text-ink outline-none select-none pointer-coarse:min-h-(--np-touch)",
  "data-highlighted:bg-fill data-selected:font-semibold",
  "data-disabled:pointer-events-none data-disabled:text-ink-muted",
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
      <SelectPrimitive.ItemIndicator className="absolute left-2.5 inline-flex items-center text-accent-ink">
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
        "px-2.5 pt-1.5 pb-0.5 text-[11.5px] font-medium text-ink-muted",
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
      className={cn("mx-0.5 my-1 h-px bg-line", className)}
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
