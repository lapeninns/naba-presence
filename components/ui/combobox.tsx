"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"

import {
  fieldControlProps,
  fieldChromeClassName,
  useFieldContext,
} from "@/components/ui/field"
import {
  MenuCloseProvider,
  MenuSheetCancel,
  MenuSheetTitle,
  menuGroupLabelClassName,
  menuItemClassName,
  menuPopupClassName,
  menuSheetListClassName,
  menuSheetPopupClassName,
  menuSheetPositionerClassName,
  menuSheetScrimClassName,
  useMenuActions,
  useMenuSheet,
} from "@/components/ui/menu-surface"
import { useMediaQuery } from "@/lib/hooks/use-media-query"
import { cn } from "@/lib/utils"

/**
 * Up to this many options a list is short enough to scan, and typing to
 * find one costs more than it saves (the client switcher uses the same 8).
 */
export const COMBOBOX_SEARCH_THRESHOLD = 8

type ComboboxSearch = "auto" | "always" | "never"

const ComboboxSearchContext = React.createContext(true)

/** How many options `items` holds, counting through `{ items }` groups. */
function countItems(items: unknown): number | undefined {
  if (!Array.isArray(items)) return undefined
  return items.reduce<number>((total, entry) => {
    const nested = (entry as { items?: unknown } | null)?.items
    return total + (Array.isArray(nested) ? nested.length : 1)
  }, 0)
}

/**
 * A text field that filters a list. `search` decides whether typing is part
 * of the control:
 *
 *   auto    (default) search only a long list: more than 8 `items`, or an
 *           unknown count. A short list on a touch screen opens without
 *           raising the keyboard and, on a phone, as an action sheet, so
 *           switching between three listings is one tap and one tap.
 *   always  always a search field.
 *   never   never raise the keyboard on touch.
 *
 *   <Combobox items={siblings} itemToStringLabel={(s) => s.name} value={current}>
 *     <ComboboxInput aria-label="Switch listing" />
 *     <ComboboxContent title="Switch listing">…items…</ComboboxContent>
 *   </Combobox>
 */
function Combobox<Value>({
  search = "auto",
  actionsRef,
  ...props
}: ComboboxPrimitive.Root.Props<Value> & { search?: ComboboxSearch }) {
  const { actions, close } = useMenuActions(actionsRef)
  const count = countItems(props.items)
  const searchable =
    search === "always" ||
    (search === "auto" &&
      (count === undefined || count > COMBOBOX_SEARCH_THRESHOLD))
  return (
    <MenuCloseProvider close={close}>
      <ComboboxSearchContext.Provider value={searchable}>
        <ComboboxPrimitive.Root
          data-slot="combobox"
          actionsRef={actions}
          {...props}
        />
      </ComboboxSearchContext.Provider>
    </MenuCloseProvider>
  )
}

/**
 * The combo box's text field: field chrome (field height, hairline edge,
 * focus halo) with the up-down chevron as a trailing button that opens the
 * list without typing. `className` reaches the `<input>`; `wrapperClassName`
 * sizes the whole control. For a short list on a touch screen the field
 * asks for no keyboard (`inputmode="none"`): a tap opens the list, and a
 * hardware keyboard can still type.
 */
function ComboboxInput({
  className,
  wrapperClassName,
  ...props
}: ComboboxPrimitive.Input.Props & { wrapperClassName?: string }) {
  // A real `<input>`, so the ordinary control wiring applies: a `FieldLabel`
  // above it keeps its `htmlFor` and labels this directly. Caller props are
  // spread last, so an explicit id or aria-label still wins.
  const field = useFieldContext()
  const searchable = React.useContext(ComboboxSearchContext)
  const coarse = useMediaQuery("(pointer: coarse)", false)
  const tapToOpen = !searchable && coarse
  return (
    <div
      data-slot="combobox-field"
      className={cn("relative w-full min-w-0", wrapperClassName)}
    >
      <ComboboxPrimitive.Input
        data-slot="combobox-input"
        inputMode={tapToOpen ? "none" : undefined}
        className={cn(
          fieldChromeClassName,
          "h-(--np-field-h) w-full pr-8 pl-[11px]",
          tapToOpen && "cursor-default caret-transparent",
          className
        )}
        {...fieldControlProps(field)}
        {...props}
      />
      <ComboboxPrimitive.Trigger
        data-slot="combobox-trigger"
        aria-label="Show options"
        className="absolute top-1/2 right-1 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-(--np-radius-tag) text-ink-muted focus-halo transition-[color,background-color] duration-(--np-duration-fast) ease-spring-snappy hover:bg-fill hover:text-ink data-disabled:pointer-events-none data-disabled:opacity-50"
      >
        <ChevronsUpDownIcon className="size-4" strokeWidth={1.75} aria-hidden />
      </ComboboxPrimitive.Trigger>
    </div>
  )
}

function ComboboxContent({
  className,
  children,
  title,
  ...props
}: ComboboxPrimitive.Popup.Props & {
  /** A heading for the phone's action sheet. */
  title?: React.ReactNode
}) {
  const phone = useMenuSheet()
  const searchable = React.useContext(ComboboxSearchContext)
  const empty = (
    <ComboboxPrimitive.Empty className="px-2 py-2 text-ui text-ink-muted">
      No matches.
    </ComboboxPrimitive.Empty>
  )

  // A short list on a phone: the action sheet, nothing typed.
  if (phone && !searchable) {
    return (
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Backdrop className={menuSheetScrimClassName} />
        <ComboboxPrimitive.Positioner className={menuSheetPositionerClassName}>
          <ComboboxPrimitive.Popup
            data-slot="combobox-content"
            data-presentation="sheet"
            className={cn(menuSheetPopupClassName, className)}
            {...props}
          >
            {title ? <MenuSheetTitle>{title}</MenuSheetTitle> : null}
            {empty}
            <ComboboxPrimitive.List className={menuSheetListClassName}>
              {children}
            </ComboboxPrimitive.List>
            <MenuSheetCancel />
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    )
  }

  // A search: the list floats under the field so the field stays where the
  // operator is typing, and stops above the on-screen keyboard.
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner sideOffset={6} className="z-popover">
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          data-presentation="popover"
          className={cn(
            menuPopupClassName,
            "max-h-[min(20rem,calc(var(--available-height)-var(--np-keyboard-inset)))] w-[var(--anchor-width)] overflow-y-auto overscroll-contain",
            className
          )}
          {...props}
        >
          {empty}
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
      <ComboboxPrimitive.ItemIndicator className="absolute left-2.5 inline-flex items-center text-accent-ink">
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
      className={cn(menuGroupLabelClassName, className)}
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
