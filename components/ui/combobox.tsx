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
  MenuSheetClose,
  MenuSheetHeader,
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
 * The combo box's text field: the text-entry field chrome (field height,
 * the 3:1 edge, the shared focus halo, the danger edge and danger halo while
 * invalid, the drawn disabled state) with the up-down chevron as a trailing
 * button that opens the list without typing. `className` reaches the
 * `<input>`; `wrapperClassName` sizes the whole control. For a short list on
 * a touch screen the field asks for no keyboard (`inputmode="none"`): a tap
 * opens the list, and a hardware keyboard can still type.
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
          // The trailing room is the trigger's: a 44px square on touch, the
          // compact 24px chevron at the desk.
          "h-(--np-field-h) w-full pr-(--np-touch) pl-(--np-field-pad-x) desk:pr-8",
          tapToOpen && "cursor-default caret-transparent",
          className
        )}
        {...fieldControlProps(field)}
        {...props}
      />
      {/* The chevron button. On touch it is a full 44px square
          (`--np-touch`) filling the field's trailing edge, so it meets the
          project's touch floor; at the desk it shrinks back to the compact
          24px chevron inset 4px from the edge. Disabled, it keeps its
          shape in the disabled ink rather than fading. */}
      <ComboboxPrimitive.Trigger
        data-slot="combobox-trigger"
        aria-label="Show options"
        className="absolute top-1/2 right-0 inline-flex size-(--np-touch) -translate-y-1/2 items-center justify-center rounded-(--np-radius-field) text-ink-muted focus-halo transition-[color,background-color] duration-(--np-duration-fast) ease-spring-snappy hover:bg-fill hover:text-ink data-disabled:pointer-events-none data-disabled:text-disabled-ink desk:right-1 desk:size-6 desk:rounded-(--np-radius-tag)"
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
  emptyText = "No matches.",
  ...props
}: ComboboxPrimitive.Popup.Props & {
  /** A heading for the phone's action sheet. */
  title?: React.ReactNode
  /**
   * What the list says when nothing matches the typed text. Default "No
   * matches.". Pass the words that fit the moment ("Searching…" while a
   * remote search is in flight would contradict "No matches.", and after a
   * failed search the honest line is the failure, not "No matches."), or
   * `null` to say nothing here because the caller shows that state itself.
   */
  emptyText?: React.ReactNode
}) {
  const phone = useMenuSheet()
  const searchable = React.useContext(ComboboxSearchContext)
  const empty =
    emptyText === null || emptyText === false ? null : (
      <ComboboxPrimitive.Empty className="px-2 py-2 text-ui text-ink-muted">
        {emptyText}
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
            <MenuSheetHeader title={title} />
            {empty}
            <ComboboxPrimitive.List className={menuSheetListClassName}>
              {children}
            </ComboboxPrimitive.List>
            <MenuSheetClose />
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
