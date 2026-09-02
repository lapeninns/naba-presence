"use client"

import { useMemo } from "react"

import { TypedAttributeControl } from "@/components/locations/typed-attribute-control"
import { Button } from "@/components/ui/button"
import type {
  AttributeMetadata,
  GoogleAttribute,
} from "@/lib/api/location-business-information"
import { groupByLabel } from "@/lib/locations/google-values"

/** Google attributes grouped by their metadata group, plus the publish trigger. */
export function AttributesSection({
  metadata,
  draft,
  onChange,
  disabled,
  hasChanges,
  publishDisabled,
  onPublish,
}: {
  metadata: readonly AttributeMetadata[]
  draft: Record<string, GoogleAttribute>
  onChange: (next: GoogleAttribute) => void
  disabled: boolean
  hasChanges: boolean
  publishDisabled: boolean
  onPublish: () => void
}) {
  const grouped = useMemo(
    () => groupByLabel(metadata, (m) => m.groupDisplayName ?? "Other"),
    [metadata]
  )

  return (
    <section className="flex max-w-xl flex-col gap-4">
      <h2 className="text-title font-semibold">Attributes</h2>
      {grouped.map(([group, items]) => (
        <div key={group} className="flex flex-col gap-3">
          <h3 className="text-ui font-semibold text-muted-foreground">
            {group}
          </h3>
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
      {hasChanges ? (
        <div>
          <Button
            variant="outline"
            onClick={onPublish}
            disabled={publishDisabled}
          >
            Publish attribute changes to Google
          </Button>
        </div>
      ) : null}
    </section>
  )
}
