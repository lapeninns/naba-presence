"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

import { useFieldTriggerProps } from "@/components/ui/field"
import {
  MenuCloseProvider,
  MenuSheetClose,
  MenuSheetHeader,
  menuGroupLabelClassName,
  menuItemClassName,
  menuPopupClassName,
  menuSeparatorClassName,
  menuSheetListClassName,
  menuSheetPopupClassName,
  menuSheetPositionerClassName,
  menuSheetScrimClassName,
  useMenuActions,
  useMenuSheet,
} from "@/components/ui/menu-surface"
import { cn } from "@/lib/utils"

/** Kept here for the callers that imported the menu recipe from Select. */
export { menuItemClassName, menuPopupClassName }

/**
 * The pop-up button (reference `.select`). The trigger is drawn as a field:
 * white, the 3:1 control edge, a caret on the right, the accent edge and
 * halo while open or focused. The popup is the shared menu: a floating
 * panel on the desk, a bottom action sheet on a phone (see menu-surface).
 */
function Select<Value>({
  actionsRef,
  ...props
}: SelectPrimitive.Root.Props<Value>) {
  const { actions, close } = useMenuActions(actionsRef)
  return (
    <MenuCloseProvider close={close}>
      <SelectPrimitive.Root
        data-slot="select"
        actionsRef={actions}
        {...props}
      />
    </MenuCloseProvider>
  )
}

/** Shared by SelectTrigger and the Combobox trigger so both read as one control. */
export const selectTriggerClassName = cn(
  "inline-flex h-(--np-field-h) min-w-0 cursor-default items-center justify-between gap-2 rounded-(--np-radius-field) border border-line-strong bg-(--np-field-bg) pr-2.5 pl-[11px] text-body text-ink outline-none select-none",
  "transition-[border-color,box-shadow] duration-(--np-duration-fast) ease-spring-snappy",
  "hover:border-ink-muted focus-visible:border-primary focus-visible:shadow-(--np-field-ring) data-popup-open:border-primary data-popup-open:shadow-(--np-field-ring) forced-colors:focus-halo",
  "disabled:cursor-not-allowed disabled:bg-surface-alt disabled:text-ink-muted data-disabled:cursor-not-allowed data-disabled:bg-surface-alt data-disabled:text-ink-muted",
  "aria-invalid:border-danger-ink aria-invalid:shadow-(--np-field-ring-invalid)",
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

function SelectContent({
  className,
  children,
  alignItemWithTrigger = true,
  title,
  ...props
}: Omit<SelectPrimitive.Popup.Props, "title"> & {
  /**
   * Base UI's default puts the popup ON the trigger, with the chosen item over
   * it — the platform behaviour, and right for a select standing on its own.
   *
   * Pass `false` for a control in a toolbar that sits directly above content:
   * an overlaying menu covers the thing the operator is filtering, and while
   * that content is still laying out the menu lands somewhere neither of them
   * agreed on. Dropping it below the control keeps it clear of both.
   *
   * The phone's action sheet ignores it: the sheet is never by the trigger.
   */
  alignItemWithTrigger?: boolean
  /**
   * The phone's action sheet heading. Required: a sheet of options that does
   * not say which field they belong to leaves the operator guessing. Use the
   * field's visible label ("Email: New review"). The desk popup ignores it.
   */
  title: string | React.ReactElement
}) {
  const sheet = useMenuSheet()
  if (sheet) {
    // The list carries the listbox role, so the header can sit in the popup
    // without being read as options.
    return (
      <SelectPrimitive.Portal>
        <SelectPrimitive.Backdrop className={menuSheetScrimClassName} />
        <SelectPrimitive.Positioner
          alignItemWithTrigger={false}
          className={menuSheetPositionerClassName}
        >
          <SelectPrimitive.Popup
            data-slot="select-content"
            data-presentation="sheet"
            className={cn(menuSheetPopupClassName, className)}
            {...props}
          >
            <MenuSheetHeader title={title} />
            <SelectPrimitive.List className={menuSheetListClassName}>
              {children}
            </SelectPrimitive.List>
            <MenuSheetClose />
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    )
  }
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        sideOffset={6}
        alignItemWithTrigger={alignItemWithTrigger}
        className="z-popover"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-presentation="popover"
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
      className={cn(menuGroupLabelClassName, className)}
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
      className={cn(menuSeparatorClassName, className)}
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
