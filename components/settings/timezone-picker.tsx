"use client"

import * as React from "react"

import {
  Combobox,
  ComboboxContent,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
} from "@/components/ui/combobox"
import {
  COMMON_TIMEZONES,
  TIMEZONE_OPTIONS,
  timezoneLabel,
} from "@/lib/settings/timezones"

/**
 * One timezone picker for setup and Settings: type to search the full IANA
 * list, with the zones agencies in this market actually use listed first.
 * Filtering is done here (`filter={null}`) so the common group can stay on
 * top and the list can say which group a zone came from.
 */
export function TimezonePicker({
  value,
  onChange,
  disabled,
  id,
  "aria-describedby": describedBy,
}: {
  value: string
  onChange: (zone: string) => void
  disabled?: boolean
  id?: string
  "aria-describedby"?: string
}) {
  const [query, setQuery] = React.useState("")
  const search = query.trim().toLowerCase()
  // Base UI writes the chosen zone's label into the input; that is a
  // selection, not a search, so it shows the whole list again.
  const searching =
    search !== "" && search !== timezoneLabel(value).toLowerCase()

  const matches = (zone: string) =>
    !searching ||
    zone.toLowerCase().includes(search) ||
    timezoneLabel(zone).toLowerCase().includes(search)

  const common = COMMON_TIMEZONES.filter(matches)
  const rest = TIMEZONE_OPTIONS.filter(
    (zone) => !COMMON_TIMEZONES.includes(zone) && matches(zone)
  )
  // A stored zone outside the list (an old default) still needs to show.
  const all = TIMEZONE_OPTIONS.includes(value)
    ? TIMEZONE_OPTIONS
    : [value, ...TIMEZONE_OPTIONS]

  return (
    <Combobox<string>
      items={all as string[]}
      filter={null}
      value={value}
      disabled={disabled}
      itemToStringLabel={timezoneLabel}
      onInputValueChange={setQuery}
      onValueChange={(next: string | null) => {
        if (next) onChange(next)
      }}
    >
      <ComboboxInput
        // Spread only when given: an explicit `undefined` would override the
        // id and description a surrounding Field wires in.
        {...(id ? { id } : {})}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
        placeholder="Search timezones"
        autoComplete="off"
        spellCheck={false}
      />
      <ComboboxContent>
        {common.length > 0 ? (
          <ComboboxGroup>
            <ComboboxGroupLabel>Common</ComboboxGroupLabel>
            {common.map((zone) => (
              <ComboboxItem key={zone} value={zone}>
                {timezoneLabel(zone)}
              </ComboboxItem>
            ))}
          </ComboboxGroup>
        ) : null}
        {rest.length > 0 ? (
          <ComboboxGroup>
            <ComboboxGroupLabel>All timezones</ComboboxGroupLabel>
            {rest.map((zone) => (
              <ComboboxItem key={zone} value={zone}>
                {timezoneLabel(zone)}
              </ComboboxItem>
            ))}
          </ComboboxGroup>
        ) : null}
      </ComboboxContent>
    </Combobox>
  )
}
