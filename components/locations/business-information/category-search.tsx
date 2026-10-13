"use client"

import { useId, useState } from "react"

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
} from "@/components/ui/combobox"
import { categoryLabel } from "@/lib/locations/console-labels"
import {
  extractCategories,
  type CategoryRef,
} from "@/lib/locations/google-values"
import { useBusinessInformationMetadata } from "@/lib/queries/use-location-business-information"

/**
 * A Google category search box; picking a result clears the query.
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
  const metadataQuery = useBusinessInformationMetadata(
    locationId,
    "categories",
    query
  )
  const categories = extractCategories(metadataQuery.data?.result)

  const errorId = `${inputId}-error`
  const failed =
    metadataQuery.isError && !metadataQuery.isFetching && query.trim() !== ""

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
        <ComboboxContent>
          {metadataQuery.isFetching ? (
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
          Google categories could not be loaded. Change the search to try again.
        </p>
      ) : null}
    </div>
  )
}
