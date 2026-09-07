import {
  diffMenuItem,
  flattenMenuItems,
  matchMenuItems,
  type FlatMenuItem,
  type MenuPrice,
} from "@/lib/domain/food-menu-import"
import { readPrice } from "@/lib/locations/forms/menu-editor"

export type MenuChangeRow = {
  key: string
  field: string
  before: string
  after: string
  state?: "changed" | "conflict"
}

export function formatMenuPrice(price: MenuPrice | null): string {
  if (!price) return ""
  const code = price.currencyCode || "GBP"
  const symbol = code === "GBP" ? "£" : `${code} `
  // The confirmation must show the same exact amount as the editor. Converting
  // int64 units to Number or rounding nanos could conceal a real price change.
  return `${symbol}${readPrice({ attributes: { price } })}`
}

function describeItem(item: FlatMenuItem): string {
  const price = formatMenuPrice(item.price)
  const parts = [item.itemLabel, price].filter(Boolean)
  return parts.join(" — ")
}

/** What publishing the entire draft changes on Google, item by item. */
export function menuChangeRows(input: {
  draft: Array<Record<string, unknown>>
  google: Array<Record<string, unknown>>
}): MenuChangeRow[] {
  const matches = matchMenuItems({
    canonicalItems: flattenMenuItems(input.draft),
    googleItems: flattenMenuItems(input.google),
    identities: [],
  })
  const rows: MenuChangeRow[] = []
  for (const match of matches) {
    if (match.local && match.google) {
      const diff = diffMenuItem(match.google, match.local)
      if (!diff || diff.changedFields.length === 0) continue
      rows.push({ key: match.local.path, field: `${match.local.sectionLabel} · ${match.local.itemLabel}`, before: describeItem(match.google), after: describeItem(match.local) })
    } else if (match.local) {
      rows.push({ key: match.local.path, field: `${match.local.sectionLabel} · ${match.local.itemLabel}`, before: "Not on Google", after: describeItem(match.local) })
    } else if (match.google) {
      rows.push({ key: match.google.path, field: `${match.google.sectionLabel} · ${match.google.itemLabel}`, before: describeItem(match.google), after: "Removed from Google", state: "conflict" })
    }
  }
  return rows
}
