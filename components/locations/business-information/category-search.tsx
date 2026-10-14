"use client"

import { useId, useState } from "react"

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
} from "@/components/ui/combobox"
import { Input, inputHints } from "@/components/ui/input"
import { OptionRow, OptionRowGroup } from "@/components/ui/option-row"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { categoryLabel } from "@/lib/locations/console-labels"
import {
  extractCategories,
  type CategoryRef,
} from "@/lib/locations/google-values"
import { useBusinessInformationMetadata } from "@/lib/queries/use-location-business-information"

/** Google's categories for a search, and whether that search failed. */
function useCategorySearch(locationId: string, query: string) {
  const metadataQuery = useBusinessInformationMetadata(
    locationId,
    "categories",
    query
  )
  const categories = extractCategories(metadataQuery.data?.result)
  const failed =
    metadataQuery.isError && !metadataQuery.isFetching && query.trim() !== ""
  return { categories, searching: metadataQuery.isFetching, failed }
}

const FAILED =
  "Google categories could not be loaded. Change the search to try again."

/**
 * A Google category search box; picking a result clears the query. The
 * desk's picker (the phone's is `CategoryPickerSheet`).
 *
 * Results are option rows in the field's list (44px on touch). Besides the
 * list's own "Searching…" and "No matches.", a failed search says so under
 * the field: an empty list after an error would otherwise read as "Google
 * has no such category". Changing the search asks Google again (the query
 * is keyed on the text), so the message says that is the retry.
 */
export function CategorySearch({
  locationId,
  label,
  disabled,
  onSelect,
}: {
  locationId: string
  label: string
  disabled: boolean
  onSelect: (category: CategoryRef) => void
}) {
  const [query, setQuery] = useState("")
  const inputId = useId()
  const { categories, searching, failed } = useCategorySearch(locationId, query)
  const errorId = `${inputId}-error`

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5 desk:max-w-xs">
      <label htmlFor={inputId} className="text-ui font-medium text-ink">
        {label}
      </label>
      <Combobox
        items={categories}
        value={null}
        filter={null}
        disabled={disabled}
        inputValue={query}
        onInputValueChange={(value) => setQuery(value)}
        onValueChange={(category: CategoryRef | null) => {
          if (!category) return
          onSelect(category)
          setQuery("")
        }}
        itemToStringLabel={(category: CategoryRef) => categoryLabel(category)}
      >
        <ComboboxInput
          id={inputId}
          placeholder="Search Google categories…"
          aria-describedby={failed ? errorId : undefined}
        />
        <ComboboxContent
          // "No matches." only once Google has answered a typed search: not
          // over "Searching…", and not after a failure (said under the field).
          emptyText={
            !searching && !failed && query.trim() !== "" ? "No matches." : null
          }
        >
          {searching ? (
            <div
              role="status"
              className="flex min-h-(--np-menu-item-h) items-center px-2 text-ui text-ink-muted"
            >
              Searching…
            </div>
          ) : (
            categories.map((category) => (
              <ComboboxItem key={category.name} value={category}>
                {categoryLabel(category)}
              </ComboboxItem>
            ))
          )}
        </ComboboxContent>
      </Combobox>
      {failed ? (
        <p id={errorId} role="alert" className="text-caption text-danger-ink">
          {FAILED}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The phone's category picker (Notion Mail's search sheet): a full sheet
 * with Google's category search over option rows. The same Google query as
 * the desk's combobox, the same "Searching…" and failure words.
 *
 * `single` (the primary category): radio rows; a tap applies the choice to
 * the draft and closes the sheet. `multiple` (additional categories):
 * checkbox rows that apply at once and stay open, ticked for the
 * categories already in the draft; a tap on a ticked one takes it out, as
 * its chip's remove does. A row that can't be chosen says why
 * (`unavailable`). Only the local draft changes: nothing reaches Google
 * until the profile's review.
 */
export function CategoryPickerSheet({
  locationId,
  title,
  open,
  onOpenChange,
  type,
  isSelected,
  unavailable,
  onSelect,
  onDeselect,
  finalFocus,
}: {
  locationId: string
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  type: "single" | "multiple"
  isSelected: (category: CategoryRef) => boolean
  /** Why a category can't be chosen now, or null when it can. */
  unavailable?: (category: CategoryRef) => string | null
  onSelect: (category: CategoryRef) => void
  onDeselect?: (category: CategoryRef) => void
  /**
   * Where focus goes when the sheet closes (the row that opened it, or a
   * stable target when that row is gone or disabled).
   */
  finalFocus?: React.ComponentProps<typeof SheetContent>["finalFocus"]
}) {
  const [query, setQuery] = useState("")
  const inputId = useId()
  const errorId = `${inputId}-error`
  const { categories, searching, failed } = useCategorySearch(locationId, query)
  const typed = query.trim() !== ""

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setQuery("")
      }}
    >
      <SheetContent variant="full" finalFocus={finalFocus}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={inputId} className="sr-only">
              Search Google categories
            </label>
            <Input
              id={inputId}
              type="search"
              value={query}
              placeholder="Search Google categories…"
              {...inputHints.search}
              autoComplete="off"
              aria-describedby={failed ? errorId : undefined}
              onChange={(event) => setQuery(event.target.value)}
            />
            {failed ? (
              <p
                id={errorId}
                role="alert"
                className="text-caption text-danger-ink"
              >
                {FAILED}
              </p>
            ) : null}
          </div>
          {searching ? (
            <p role="status" className="px-3 text-ui text-ink-muted">
              Searching…
            </p>
          ) : typed && !failed && categories.length === 0 ? (
            <p role="status" className="px-3 text-ui text-ink-muted">
              No matches.
            </p>
          ) : null}
          {!searching && categories.length > 0 ? (
            <OptionRowGroup
              label={title}
              type={type}
              // A primary pick applies and closes: arrows only move.
              applyOnChoose={type === "single"}
              className="-mx-3"
            >
              {categories.map((category) => {
                const selected = isSelected(category)
                const reason = selected
                  ? null
                  : (unavailable?.(category) ?? null)
                return (
                  <OptionRow
                    key={category.name}
                    indicator={type === "single" ? "radio" : "checkbox"}
                    selected={selected}
                    disabled={reason !== null}
                    label={categoryLabel(category)}
                    description={reason ?? undefined}
                    onClick={() => {
                      if (selected) {
                        if (type === "multiple") onDeselect?.(category)
                        else onOpenChange(false)
                        return
                      }
                      onSelect(category)
                      if (type === "single") {
                        setQuery("")
                        onOpenChange(false)
                      }
                    }}
                  />
                )
              })}
            </OptionRowGroup>
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
