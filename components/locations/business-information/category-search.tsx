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

/** A Google category search box; picking a result clears the query. */
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

  return (
    <div className="flex max-w-xs flex-col gap-1">
      <label htmlFor={inputId} className="text-caption text-muted-foreground">
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
        <ComboboxInput id={inputId} placeholder="Search Google categories…" />
        <ComboboxContent>
          {metadataQuery.isFetching ? (
            <div className="px-3 py-2 text-ui text-muted-foreground">
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
    </div>
  )
}
