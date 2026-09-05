"use client"

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"

import { fieldChromeClassName } from "@/components/ui/field"
import { menuItemClassName, menuPopupClassName } from "@/components/ui/select"
import { cn } from "@/lib/utils"

function Combobox<Value>(props: ComboboxPrimitive.Root.Props<Value>) {
  return <ComboboxPrimitive.Root data-slot="combobox" {...props} />
}

/**
 * The combo box's text field: field chrome (field height, hairline edge,
 * focus halo) with the up-down chevron as a trailing button that opens the
 * list without typing. `className` reaches the `<input>`; `wrapperClassName`
 * sizes the whole control.
 */
function ComboboxInput({
  className,
  wrapperClassName,
  ...props
}: ComboboxPrimitive.Input.Props & { wrapperClassName?: string }) {
  return (
    <div
      data-slot="combobox-field"
      className={cn("relative w-full min-w-0", wrapperClassName)}
    >
      <ComboboxPrimitive.Input
        data-slot="combobox-input"
        className={cn(
          fieldChromeClassName,
          "h-(--np-field-h) w-full pr-8 pl-3",
          className
        )}
        {...props}
      />
      <ComboboxPrimitive.Trigger
        data-slot="combobox-trigger"
        aria-label="Show options"
        className="absolute top-1/2 right-1 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-(--np-radius-tag) text-ink-muted focus-halo transition-[color,background-color] duration-(--np-duration-fast) ease-spring-snappy hover:bg-fill-tertiary hover:text-ink data-disabled:pointer-events-none data-disabled:opacity-50"
      >
        <ChevronsUpDownIcon className="size-4" strokeWidth={1.75} aria-hidden />
      </ComboboxPrimitive.Trigger>
    </div>
  )
}

function ComboboxContent({
  className,
  children,
  ...props
}: ComboboxPrimitive.Popup.Props) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner sideOffset={6} className="z-50">
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            menuPopupClassName,
            "max-h-[min(20rem,var(--available-height))] w-[var(--anchor-width)] overflow-y-auto",
            className
          )}
          {...props}
        >
          <ComboboxPrimitive.Empty className="px-2 py-2 text-ui text-ink-muted">
            No matches.
          </ComboboxPrimitive.Empty>
          <ComboboxPrimitive.List>{children}</ComboboxPrimitive.List>
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxItem({
  className,
  children,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(menuItemClassName, className)}
      {...props}
    >
      <ComboboxPrimitive.ItemIndicator className="absolute left-2 inline-flex items-center">
        <CheckIcon className="size-4" strokeWidth={2} aria-hidden />
      </ComboboxPrimitive.ItemIndicator>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </ComboboxPrimitive.Item>
  )
}

function ComboboxGroup(props: ComboboxPrimitive.Group.Props) {
  return <ComboboxPrimitive.Group data-slot="combobox-group" {...props} />
}

function ComboboxGroupLabel({
  className,
  ...props
}: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-group-label"
      className={cn(
        "px-2 py-1.5 text-caption font-medium text-ink-muted",
        className
      )}
      {...props}
    />
  )
}

export {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxItem,
  ComboboxGroup,
  ComboboxGroupLabel,
}
