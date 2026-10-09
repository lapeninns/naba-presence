"use client"

import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const ALL = "__all__"

/**
 * Which of a client's listings a report covers (the scope's `Location`
 * field, under Client). Picking one opens that listing's report
 * (`?locationId=`); "Every location" stays on the whole client.
 *
 * Without it, a single listing's report could only be reached from the
 * listing itself or the hub, never from the report you were already on.
 */
export function LocationSelect({
  locations,
  value,
  onChange,
}: {
  locations: Array<{ id: string; name: string }>
  value: string | undefined
  onChange: (locationId: string | undefined) => void
}) {
  if (locations.length < 2) return null

  return (
    <Field className="min-w-44 flex-[1_1_11rem] sm:flex-none">
      <FieldLabel>Location</FieldLabel>
      <Select
        value={value ?? ALL}
        onValueChange={(next: string | null) =>
          onChange(next && next !== ALL ? next : undefined)
        }
      >
        <SelectTrigger className="w-full sm:w-56">
          <SelectValue>
            {(selected: string | null) =>
              selected && selected !== ALL
                ? (locations.find((location) => location.id === selected)
                    ?.name ?? "Every location")
                : "Every location"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Every location</SelectItem>
          {locations.map((location) => (
            <SelectItem key={location.id} value={location.id}>
              {location.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
