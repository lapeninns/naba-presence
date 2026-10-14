"use client"

import { ListFilterIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { FilterChipStrip } from "@/components/ui/chip"
import { SearchInput } from "@/components/ui/input"
import { mediaQuery } from "@/lib/ui/breakpoints"
import { cn } from "@/lib/utils"

/**
 * The list toolbar (brief §4.3): the sticky band under the page header.
 *
 *   [ (search field, pill)              ] [Filter] [view]
 *   [ active filter chips (only when there are any)         ]
 *   Results label
 *
 * - The search field is 44px, a pill on `fill-secondary`, with a leading
 *   magnifier and a "Clear search" button once there is text. Its value is
 *   controlled (`searchValue` + `onSearchChange`) or not
 *   (`defaultSearchValue`).
 * - `filter` is a slot, normally a `FilterButton` (a 44px circle with a
 *   count; it can be a sheet trigger's `render` element). `view` is an
 *   optional view toggle.
 * - SEARCH MODE (Notion Mail's search takeover, phones): focusing the field
 *   on a touch layout (anything that is not `desk`), or `searchMode={true}`,
 *   hides the `header` slot and the filter/view controls and shows the field
 *   with a "Cancel" text button. Cancel or Escape clears the query, leaves
 *   search mode and puts focus back where it was before (or on the filter
 *   button). Controlled with `searchMode` + `onSearchModeChange`.
 * - `resultsLabel` is announced politely (`role="status"`).
 * - `searchRegionLabel` names the `role="search"` landmark ("Filter
 *   listings"); unnamed by default. `search={false}` drops the field (and
 *   search mode) for a toolbar of filters only.
 * - The field keeps a 12rem basis: when the filter and view controls do
 *   not fit beside it (a 320px phone), the `view` slot wraps onto its own
 *   line below instead of squeezing the field.
 */
export type ToolbarProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** Header content inside the band (a `ViewHeader`), hidden in search mode. */
  header?: React.ReactNode
  searchValue?: string
  defaultSearchValue?: string
  onSearchChange?: (value: string) => void
  /** The search field's accessible name. */
  searchLabel?: string
  /** Names the `role="search"` landmark. Unnamed by default. */
  searchRegionLabel?: string
  /** `false`: no search field (a toolbar of filters only). Default true. */
  search?: boolean
  searchPlaceholder?: string
  /** Extra props for the `<input>` (`enterKeyHint`, `onKeyDown`, …). */
  searchInputProps?: Omit<
    React.ComponentProps<"input">,
    "value" | "defaultValue" | "type" | "ref"
  >
  /** The search field; `null` when `search` is false. */
  searchRef?: React.Ref<HTMLInputElement | null>
  /** Controlled search mode. */
  searchMode?: boolean
  onSearchModeChange?: (searchMode: boolean) => void
  /** Enter search mode when the field gets focus on touch. Default true. */
  searchModeOnFocus?: boolean
  cancelLabel?: string
  /** The filter control, normally a `FilterButton`. */
  filter?: React.ReactNode
  /** An optional view toggle. */
  view?: React.ReactNode
  /** Active filter chips (`FilterChip onRemove`); the row shows only with chips. */
  chips?: React.ReactNode
  /** "12 reviews", "Results": `text-ui ink-muted`, announced politely. */
  resultsLabel?: React.ReactNode
  sticky?: boolean
}

function isTouchLayout() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return false
  return !window.matchMedia(mediaQuery("desk")).matches
}

function Toolbar({
  header,
  searchValue,
  defaultSearchValue = "",
  onSearchChange,
  searchLabel = "Search",
  searchRegionLabel,
  search = true,
  searchPlaceholder = "Search",
  searchInputProps,
  searchRef,
  searchMode: searchModeProp,
  onSearchModeChange,
  searchModeOnFocus = true,
  cancelLabel = "Cancel",
  filter,
  view,
  chips,
  resultsLabel,
  sticky = true,
  className,
  ...props
}: ToolbarProps) {
  const [innerValue, setInnerValue] = React.useState(defaultSearchValue)
  const value = searchValue ?? innerValue
  const [innerMode, setInnerMode] = React.useState(false)
  // No field, no search mode.
  const searchMode = search && (searchModeProp ?? innerMode)

  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const filterRef = React.useRef<HTMLDivElement>(null)
  const returnFocusRef = React.useRef<HTMLElement | null>(null)
  const restorePendingRef = React.useRef(false)

  React.useImperativeHandle<HTMLInputElement | null, HTMLInputElement | null>(
    searchRef,
    () => inputRef.current
  )

  const setValue = (next: string) => {
    if (searchValue === undefined) setInnerValue(next)
    onSearchChange?.(next)
  }

  const setMode = (next: boolean) => {
    if (searchModeProp === undefined) setInnerMode(next)
    onSearchModeChange?.(next)
  }

  const exitSearchMode = () => {
    if (value) setValue("")
    restorePendingRef.current = true
    setMode(false)
  }

  // Search mode switched on from outside (a search icon, a shortcut): the
  // field takes focus, remembering where focus was.
  React.useEffect(() => {
    if (!searchMode) return
    const input = inputRef.current
    if (!input || document.activeElement === input) return
    const from = document.activeElement
    returnFocusRef.current = from instanceof HTMLElement ? from : null
    input.focus()
  }, [searchMode])

  // Back out of search mode: once the filter controls are drawn again, put
  // focus where it was before the field took it, or on the filter button.
  React.useEffect(() => {
    if (searchMode || !restorePendingRef.current) return
    restorePendingRef.current = false
    const back = returnFocusRef.current
    returnFocusRef.current = null
    if (back && back.isConnected && back !== document.body) {
      back.focus()
      return
    }
    const fallback = filterRef.current?.querySelector<HTMLElement>(
      "button, [href], [tabindex]:not([tabindex='-1'])"
    )
    if (fallback) fallback.focus()
    else inputRef.current?.blur()
  }, [searchMode])

  const chipCount = React.Children.toArray(chips).length

  return (
    <div
      data-slot="toolbar"
      data-search-mode={searchMode || undefined}
      className={cn(
        "flex min-w-0 flex-col gap-2 bg-surface py-2",
        sticky && "sticky top-0 z-sticky",
        sticky && header != null && "pt-safe",
        className
      )}
      {...props}
    >
      {header != null ? (
        <div data-slot="toolbar-header" hidden={searchMode}>
          {header}
        </div>
      ) : null}
      <div
        data-slot="toolbar-row"
        // Wraps so a view control drops below the field at 320px; never in
        // search mode, where Cancel must stay beside the field.
        className={cn(
          "flex min-w-0 items-center gap-2",
          searchMode ? "flex-nowrap" : "flex-wrap"
        )}
      >
        {search ? (
          <div
            role="search"
            aria-label={searchRegionLabel}
            data-slot="toolbar-search"
            className="min-w-0 flex-1 basis-48"
          >
            <SearchInput
              ref={inputRef}
              aria-label={searchLabel}
              placeholder={searchPlaceholder}
              enterKeyHint="search"
              autoCorrect="off"
              spellCheck={false}
              {...searchInputProps}
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
                searchInputProps?.onChange?.(event)
              }}
              onFocus={(event) => {
                searchInputProps?.onFocus?.(event)
                if (searchMode || !searchModeOnFocus || !isTouchLayout()) return
                const from = event.relatedTarget
                returnFocusRef.current =
                  from instanceof HTMLElement ? from : null
                setMode(true)
              }}
              onKeyDown={(event) => {
                searchInputProps?.onKeyDown?.(event)
                if (event.defaultPrevented) return
                if (event.key === "Escape" && searchMode) {
                  event.preventDefault()
                  exitSearchMode()
                }
              }}
              className="h-(--np-touch) rounded-(--np-radius-pill) border-transparent bg-fill-secondary ps-3 hover:border-transparent desk:h-(--np-control-h)"
            />
          </div>
        ) : null}
        {searchMode ? (
          <Button
            variant="ghost"
            data-slot="toolbar-cancel"
            onClick={exitSearchMode}
            className="min-h-(--np-touch) px-2 text-body font-normal text-accent-ink"
          >
            {cancelLabel}
          </Button>
        ) : (
          <>
            {filter != null ? (
              <div
                ref={filterRef}
                data-slot="toolbar-filter"
                className="flex shrink-0"
              >
                {filter}
              </div>
            ) : null}
            {view != null ? (
              <div data-slot="toolbar-view" className="flex shrink-0">
                {view}
              </div>
            ) : null}
          </>
        )}
      </div>
      {chipCount > 0 ? (
        <FilterChipStrip data-slot="toolbar-chips">{chips}</FilterChipStrip>
      ) : null}
      {/* Always mounted, so the first results label is announced too: many
          screen readers skip a live region's first content when the region
          mounts with it. Empty, it is visually hidden but stays in the
          accessibility tree. */}
      <p
        role="status"
        data-slot="toolbar-results"
        className="text-ui text-ink-muted empty:sr-only"
      >
        {resultsLabel}
      </p>
    </div>
  )
}

/**
 * The Filter button: a 44px circle (36px on a desk) on `fill-secondary`.
 * With filters active the icon turns `accent-ink`, a count badge appears,
 * and the name says how many ("Filters, 3 active"), so the state is never
 * colour alone. Pass it as a sheet trigger's `render` element to open the
 * filter sheet.
 */
function FilterButton({
  count = 0,
  label = "Filters",
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "children" | "aria-label"> & {
  /** A trigger's element, as on `Button`. */
  render?: React.ComponentProps<typeof Button>["render"]
  /** Active filters. */
  count?: number
  label?: string
}) {
  const active = count > 0
  return (
    <Button
      variant="ghost"
      size="icon"
      pill
      data-slot="filter-button"
      data-active={active || undefined}
      aria-label={active ? `${label}, ${count} active` : label}
      className={cn(
        "relative bg-fill-secondary hover:not-data-disabled:bg-fill",
        className
      )}
      {...props}
    >
      <ListFilterIcon
        aria-hidden
        className={cn("size-5", active ? "text-accent-ink" : "text-ink")}
      />
      {active ? (
        <span
          aria-hidden
          data-slot="filter-button-count"
          className="absolute -end-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-(--np-radius-pill) bg-accent-solid px-1 text-count leading-none font-semibold text-ink-on-accent tabular-nums"
        >
          {count}
        </span>
      ) : null}
    </Button>
  )
}

export { FilterButton, Toolbar }
