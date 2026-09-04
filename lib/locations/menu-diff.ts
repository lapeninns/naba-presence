import {
  diffMenuItem,
  flattenMenuItems,
  matchMenuItems,
  type FlatMenuItem,
  type MenuPrice,
} from "@/lib/domain/food-menu-import"

export type MenuChangeRow = {
  key: string
  field: string
  before: string
  after: string
  state?: "changed" | "conflict"
}

export function formatMenuPrice(price: MenuPrice | null): string {
  if (!price) return ""
  const units = Number.parseInt(price.units, 10)
  const amount =
    (Number.isFinite(units) ? units : 0) + price.nanos / 1_000_000_000
  const symbol =
    price.currencyCode === "GBP" || !price.currencyCode
      ? "£"
      : `${price.currencyCode} `
  return `${symbol}${amount.toFixed(2)}`
}

function describeItem(item: FlatMenuItem): string {
  const price = formatMenuPrice(item.price)
  const parts = [item.itemLabel, price].filter(Boolean)
  return parts.join(" — ")
}

/**
 * What publishing this menu draft does to Google, item by item.
 *
 * Publishing replaces Google's whole food menu, which the old dialog told the
 * operator in a sentence and then asked them to tick a box. The rows say which
 * items appear, change and disappear, so "replaces the whole menu" is something
 * they can check rather than something they have to trust.
 */
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
      // Publishing pushes local over Google, so diff in that direction.
      const diff = diffMenuItem(match.google, match.local)
      if (!diff || diff.changedFields.length === 0) continue
      rows.push({
        key: match.local.path,
        field: `${match.local.sectionLabel} · ${match.local.itemLabel}`,
        before: describeItem(match.google),
        after: describeItem(match.local),
      })
    } else if (match.local) {
      rows.push({
        key: match.local.path,
        field: `${match.local.sectionLabel} · ${match.local.itemLabel}`,
        before: "Not on Google",
        after: describeItem(match.local),
      })
    } else if (match.google) {
      rows.push({
        key: match.google.path,
        field: `${match.google.sectionLabel} · ${match.google.itemLabel}`,
        before: describeItem(match.google),
        after: "Removed from Google",
        state: "conflict",
      })
    }
  }
  return rows
}
