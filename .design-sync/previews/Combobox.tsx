import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxValue,
  Label,
} from "NabaReview"

// Items are rendered through ComboboxCollection rather than mapped by hand:
// Base UI filters `items` against the query and Collection renders only the
// survivors, so the empty state and the popup's `data-empty` flag stay honest.

const LOCATIONS = [
  "Lapen Inn — Central",
  "Lapen Inn — Riverside",
  "Lapen Inn — Airport",
  "Lapen Inn — Harbour Quay",
  "Lapen Inn — Old Town",
  "Lapen Inn — Station Road",
  "Lapen Lodge — Northgate",
  "Lapen Lodge — Westfield",
]

const TAGS = [
  "Breakfast",
  "Cleanliness",
  "Front desk",
  "Housekeeping",
  "Noise",
  "Parking",
  "Value",
  "Wi-Fi",
]

export function LocationPicker() {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="review-location">Filter reviews by location</Label>
      <Combobox items={LOCATIONS} defaultValue="Lapen Inn — Riverside">
        <ComboboxInput
          id="review-location"
          placeholder="Search locations…"
          className="w-72"
        />
        <ComboboxContent>
          <ComboboxEmpty>No location matches that search.</ComboboxEmpty>
          <ComboboxList>
            <ComboboxCollection>
              {(name: string) => (
                <ComboboxItem key={name} value={name}>
                  {name}
                </ComboboxItem>
              )}
            </ComboboxCollection>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <span className="text-xs text-muted-foreground">
        8 connected Business Profiles.
      </span>
    </div>
  )
}

const GROUPED = [
  { label: "Hotels", items: LOCATIONS.slice(0, 4) },
  { label: "Lodges", items: LOCATIONS.slice(6) },
]

export function OpenLocationList() {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="location-search">Move review to</Label>
      <Combobox items={GROUPED} open defaultValue="Lapen Inn — Central">
        <ComboboxInput
          id="location-search"
          placeholder="Search locations…"
          className="w-72"
        />
        <ComboboxContent>
          <ComboboxEmpty>No location matches that search.</ComboboxEmpty>
          <ComboboxList>
            {(group: { label: string; items: string[] }) => (
              <ComboboxGroup key={group.label} items={group.items}>
                <ComboboxLabel>{group.label}</ComboboxLabel>
                <ComboboxCollection>
                  {(name: string) => (
                    <ComboboxItem key={name} value={name}>
                      {name}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  )
}

export function TagFilterChips() {
  return (
    <div className="flex flex-col gap-2">
      <Label>Review tags</Label>
      <Combobox
        items={TAGS}
        multiple
        defaultValue={["Breakfast", "Cleanliness", "Front desk"]}
      >
        <ComboboxChips className="w-72">
          <ComboboxValue>
            {(tags: string[]) =>
              tags.map((tag) => <ComboboxChip key={tag}>{tag}</ComboboxChip>)
            }
          </ComboboxValue>
          <ComboboxChipsInput placeholder="Add tag…" />
        </ComboboxChips>
        <ComboboxContent>
          <ComboboxEmpty>No matching tag.</ComboboxEmpty>
          <ComboboxList>
            <ComboboxCollection>
              {(tag: string) => (
                <ComboboxItem key={tag} value={tag}>
                  {tag}
                </ComboboxItem>
              )}
            </ComboboxCollection>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <span className="text-xs text-muted-foreground">
        3 of 8 tags applied to the review queue.
      </span>
    </div>
  )
}

export function NoMatches() {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="no-match-search">Filter reviews by location</Label>
      <Combobox items={LOCATIONS} open defaultInputValue="conference centre">
        <ComboboxInput
          id="no-match-search"
          placeholder="Search locations…"
          className="w-72"
        />
        <ComboboxContent>
          <ComboboxEmpty>No location matches that search.</ComboboxEmpty>
          <ComboboxList>
            <ComboboxCollection>
              {(name: string) => (
                <ComboboxItem key={name} value={name}>
                  {name}
                </ComboboxItem>
              )}
            </ComboboxCollection>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  )
}
