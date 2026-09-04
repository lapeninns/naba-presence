"use client"

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"

import { cn } from "@/lib/utils"

function Combobox<Value>(props: ComboboxPrimitive.Root.Props<Value>) {
  return <ComboboxPrimitive.Root data-slot="combobox" {...props} />
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(
        "h-8 w-full min-w-0 rounded-(--np-radius-control) border border-border bg-card px-3 text-ui focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
        className
      )}
      {...props}
    />
  )
}

function ComboboxContent({ className, children, ...props }: ComboboxPrimitive.Popup.Props) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner sideOffset={6} className="z-50">
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "max-h-[min(20rem,var(--available-height))] w-[var(--anchor-width)] overflow-y-auto rounded-(--np-radius-modal) border bg-popover p-1 text-popover-foreground shadow-(--np-shadow-modal) outline-none",
            className
          )}
          {...props}
        >
          <ComboboxPrimitive.Empty className="px-3 py-2 text-ui text-muted-foreground">
            No matches.
          </ComboboxPrimitive.Empty>
          <ComboboxPrimitive.List>{children}</ComboboxPrimitive.List>
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxItem({ className, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "flex cursor-default items-center rounded-(--np-radius-control) px-3 py-1.5 text-ui outline-none data-highlighted:bg-muted",
        className
      )}
      {...props}
    />
  )
}

export { Combobox, ComboboxInput, ComboboxContent, ComboboxItem }
