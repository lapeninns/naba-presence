"use client"

import { useMemo } from "react"

import { TypedAttributeControl } from "@/components/locations/typed-attribute-control"
import type {
  AttributeMetadata,
  GoogleAttribute,
} from "@/lib/api/location-business-information"
import { groupByLabel } from "@/lib/locations/google-values"

/**
 * Google's attributes, grouped as Google groups them.
 *
 * The publish button that used to sit at the bottom of this list is gone:
 * attributes go out with the rest of the listing, through the one review sheet,
 * so an operator no longer has to remember that this section published itself
 * separately.
 */
export function AttributesSection({
  metadata,
  draft,
  onChange,
  disabled,
}: {
  metadata: readonly AttributeMetadata[]
  draft: Record<string, GoogleAttribute>
  onChange: (next: GoogleAttribute) => void
  disabled: boolean
}) {
  const grouped = useMemo(
    () => groupByLabel(metadata, (m) => m.groupDisplayName ?? "Other"),
    [metadata]
  )

  if (metadata.length === 0) return null

  return (
    <section className="flex max-w-xl flex-col gap-4">
      <h3 className="text-title font-medium">Attributes</h3>
      {grouped.map(([group, items]) => (
        <div key={group} className="flex flex-col gap-3">
          <h4 className="text-ui font-medium text-ink-muted">{group}</h4>
          <div className="flex flex-col gap-3">
            {items.map((meta) => (
              <TypedAttributeControl
                key={meta.parent}
                metadata={meta}
                attribute={draft[meta.parent]}
                disabled={disabled}
                onChange={onChange}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
