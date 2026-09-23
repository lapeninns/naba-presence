"use client"

import { useMemo } from "react"

import { SectionCard } from "@/components/locations/profile/section-card"
import { TypedAttributeControl } from "@/components/locations/typed-attribute-control"
import { GroupedList } from "@/components/ui/grouped-list"
import type {
  AttributeMetadata,
  GoogleAttribute,
} from "@/lib/api/location-business-information"
import { groupByLabel } from "@/lib/locations/google-values"

/**
 * Google's attributes, grouped as Google groups them: one bordered list per
 * group (reference `.attr-group`), a row per attribute.
 *
 * Attributes go out with the rest of the listing, through the one review
 * sheet, so an operator doesn't have to remember that this section used to
 * publish itself separately.
 */
export function AttributesSection({
  metadata,
  draft,
  initial,
  onChange,
  onClear,
  disabled,
}: {
  metadata: readonly AttributeMetadata[]
  draft: Record<string, GoogleAttribute>
  /** What Google holds, for the per-row "Changed" marks. */
  initial?: Record<string, GoogleAttribute>
  onChange: (next: GoogleAttribute) => void
  onClear?: (name: string) => void
  disabled: boolean
}) {
  const grouped = useMemo(
    () => groupByLabel(metadata, (m) => m.groupDisplayName ?? "Other"),
    [metadata]
  )

  if (metadata.length === 0) return null

  const isChanged = (name: string) =>
    initial !== undefined &&
    JSON.stringify(draft[name]) !== JSON.stringify(initial[name])
  const anyChanged = metadata.some((meta) => isChanged(meta.parent))

  return (
    <SectionCard
      id="section-attributes"
      title="Attributes"
      description="Facts Google shows on the listing, as Google groups them. Only the attributes Google offers for this kind of business appear here."
      changed={anyChanged}
      bare
    >
      {grouped.map(([group, items]) => (
        <GroupedList key={group} header={group}>
          {items.map((meta) => (
            <li
              key={meta.parent}
              className="flex min-h-12 items-center border-t border-line px-4 py-2.5 first:border-t-0"
            >
              <TypedAttributeControl
                metadata={meta}
                attribute={draft[meta.parent]}
                disabled={disabled}
                onChange={onChange}
                onClear={onClear}
                changed={isChanged(meta.parent)}
              />
            </li>
          ))}
        </GroupedList>
      ))}
    </SectionCard>
  )
}
