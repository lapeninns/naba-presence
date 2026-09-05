"use client"

import { useMemo } from "react"

import { TypedAttributeControl } from "@/components/locations/typed-attribute-control"
import { GroupedList } from "@/components/ui/grouped-list"
import type {
  AttributeMetadata,
  GoogleAttribute,
} from "@/lib/api/location-business-information"
import { groupByLabel } from "@/lib/locations/google-values"

/**
 * Google's attributes, grouped as Google groups them: one inset list per
 * group, a row per attribute.
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
    <section className="flex max-w-2xl flex-col gap-4">
      <h3 className="text-title font-semibold text-ink">Attributes</h3>
      {grouped.map(([group, items]) => (
        <GroupedList key={group} header={group}>
          {items.map((meta) => (
            <li
              key={meta.parent}
              className="flex min-h-(--np-row-h) items-center border-t border-line-subtle px-(--np-card-pad) py-2.5 first:border-t-0 [&>*]:w-full"
            >
              <TypedAttributeControl
                metadata={meta}
                attribute={draft[meta.parent]}
                disabled={disabled}
                onChange={onChange}
              />
            </li>
          ))}
        </GroupedList>
      ))}
    </section>
  )
}
