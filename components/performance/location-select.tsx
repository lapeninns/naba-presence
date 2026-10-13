"use client"

import {
  ScopeSelect,
  scopeFieldInRowClassName,
  scopeTriggerInRowClassName,
} from "@/components/performance/scope-select"

/**
 * Which of a client's listings a report covers (the scope's `Location`
 * field, under Client). Picking one opens that listing's report
 * (`?locationId=`); "Every location" stays on the whole client.
 *
 * Without it, a single listing's report could only be reached from the
 * listing itself or the hub, never from the report you were already on.
 * With fewer than two locations there is nothing to choose, so nothing
 * renders.
 */
export function LocationSelect({
  locations,
  value,
  onChange,
  className = scopeFieldInRowClassName,
  triggerClassName = scopeTriggerInRowClassName,
}: {
  locations: Array<{ id: string; name: string }>
  value: string | undefined
  onChange: (locationId: string | undefined) => void
  className?: string
  triggerClassName?: string
}) {
  if (locations.length < 2) return null

  return (
    <ScopeSelect
      label="Location"
      allLabel="Every location"
      value={value}
      onChange={onChange}
      options={locations.map((location) => ({
        id: location.id,
        label: location.name,
      }))}
      className={className}
      triggerClassName={triggerClassName}
    />
  )
}
