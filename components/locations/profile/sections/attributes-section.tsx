"use client"

import { useId, useMemo, type ReactNode } from "react"

import { SectionCard } from "@/components/locations/profile/section-card"
import { TypedAttributeControl } from "@/components/locations/typed-attribute-control"
import { SettingsGroup } from "@/components/ui/settings-row"
import type {
  AttributeMetadata,
  GoogleAttribute,
} from "@/lib/api/location-business-information"
import { groupByLabel } from "@/lib/locations/google-values"

/**
 * Google's attributes, grouped as Google groups them: one settings group per
 * Google group (flat on a phone, a quiet card on a desk), and a settings row
 * per attribute drawn by the typed control's `row` layout (label at the
 * leading edge, the Yes / No / Not set choice, Select or URL field at the
 * trailing edge).
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
  errors,
}: {
  metadata: readonly AttributeMetadata[]
  draft: Record<string, GoogleAttribute>
  /** What Google holds, for the per-row "Changed" marks. */
  initial?: Record<string, GoogleAttribute>
  onChange: (next: GoogleAttribute) => void
  onClear?: (name: string) => void
  disabled: boolean
  /** Values Google won't accept, by attribute name, shown under each row. */
  errors?: Readonly<Record<string, string>>
}) {
  const grouped = useMemo(
    () => groupByLabel(metadata, (m) => m.groupDisplayName ?? "Other"),
    [metadata]
  )

  // Which rows differ from Google, worked out once per draft change rather
  // than twice per row on every render of the profile.
  const changedNames = useMemo(
    () =>
      new Set(
        initial === undefined
          ? []
          : metadata
              .filter(
                (meta) =>
                  JSON.stringify(draft[meta.parent]) !==
                  JSON.stringify(initial[meta.parent])
              )
              .map((meta) => meta.parent)
      ),
    [metadata, draft, initial]
  )

  if (metadata.length === 0) return null

  const isChanged = (name: string) => changedNames.has(name)
  const anyChanged = changedNames.size > 0

  return (
    <SectionCard
      id="section-attributes"
      title="Attributes"
      description="Facts Google shows on the listing, as Google groups them. Only the attributes Google offers for this kind of business appear here."
      changed={anyChanged}
      bare
    >
      {grouped.map(([group, items]) => (
        <AttributeGroup key={group} label={group}>
          {items.map((meta) => (
            <li key={meta.parent} className="min-w-0 desk:px-2">
              <TypedAttributeControl
                layout="row"
                metadata={meta}
                attribute={draft[meta.parent]}
                disabled={disabled}
                onChange={onChange}
                onClear={onClear}
                changed={isChanged(meta.parent)}
                error={errors?.[meta.parent]}
              />
            </li>
          ))}
        </AttributeGroup>
      ))}
    </SectionCard>
  )
}

/**
 * One Google attribute group. The label is an `h4` under the section's
 * `h3` (SettingsGroup only draws h2/h3 headings), so it sits above an
 * unlabelled SettingsGroup that names its rows' list instead: the group
 * keeps SettingsGroup's flat phone rows and desk card, and the outline
 * stays Attributes > group.
 */
function AttributeGroup({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col">
      <h4
        id={`${id}-label`}
        className="flex min-h-(--np-touch) items-center text-caption font-medium text-ink-muted desk:min-h-8"
      >
        {label}
      </h4>
      <SettingsGroup
        card
        className="mt-0"
        listProps={{ "aria-labelledby": `${id}-label` }}
      >
        {children}
      </SettingsGroup>
    </div>
  )
}
