"use client"

import { useMemo } from "react"

import {
  diffMenuItem,
  flattenMenuItems,
  matchMenuItems,
  type MenuPrice,
} from "@/lib/domain/food-menu-import"

function formatPrice(price: MenuPrice | null): string {
  if (!price) return ""
  const units = Number.parseInt(price.units, 10)
  const amount = (Number.isFinite(units) ? units : 0) + price.nanos / 1_000_000_000
  return ` — ${price.currencyCode === "GBP" || !price.currencyCode ? "£" : `${price.currencyCode} `}${amount.toFixed(2)}`
}

/**
 * Client-side preview of exactly what publishing will change on Google,
 * computed from the same payloads whose hashes pin the publish (the server
 * refuses the publish if either side moved after this was rendered).
 */
export function MenuPublishPreview({
  canonicalMenus,
  googleMenus,
}: {
  canonicalMenus: Array<Record<string, unknown>>
  googleMenus: Array<Record<string, unknown>>
}) {
  const preview = useMemo(() => {
    const matches = matchMenuItems({
      canonicalItems: flattenMenuItems(canonicalMenus),
      googleItems: flattenMenuItems(googleMenus),
      identities: [],
    })
    const adds: string[] = []
    const changes: string[] = []
    const removals: string[] = []
    for (const match of matches) {
      if (match.local && match.google) {
        // Publishing pushes local over Google, so diff in that direction.
        const diff = diffMenuItem(match.google, match.local)
        if (diff && diff.changedFields.length > 0) {
          changes.push(
            `${match.local.sectionLabel} · ${match.local.itemLabel} (${diff.changedFields.join(", ")})`
          )
        }
      } else if (match.local) {
        adds.push(
          `${match.local.sectionLabel} · ${match.local.itemLabel}${formatPrice(match.local.price)}`
        )
      } else if (match.google) {
        removals.push(`${match.google.sectionLabel} · ${match.google.itemLabel}`)
      }
    }
    return { adds, changes, removals }
  }, [canonicalMenus, googleMenus])

  if (!preview.adds.length && !preview.changes.length && !preview.removals.length) {
    return null
  }

  return (
    <div className="flex max-h-64 flex-col gap-3 overflow-y-auto rounded-md border p-3 text-caption">
      {preview.adds.length > 0 ? (
        <div>
          <p className="font-medium">Will add on Google</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {preview.adds.map((entry) => (
              <li key={`add-${entry}`}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview.changes.length > 0 ? (
        <div>
          <p className="font-medium">Will change on Google</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {preview.changes.map((entry) => (
              <li key={`change-${entry}`}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview.removals.length > 0 ? (
        <div>
          <p className="font-medium">Will remove on Google</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {preview.removals.map((entry) => (
              <li key={`remove-${entry}`}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
