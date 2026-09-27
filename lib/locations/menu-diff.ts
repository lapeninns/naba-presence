import type { MenuPrice } from "@/lib/domain/food-menu-import"

type MenuNode = Record<string, unknown>

export type MenuChangeRow = {
  readonly key: string
  readonly field: string
  readonly before: string
  readonly after: string
  readonly state?: "changed" | "conflict"
  readonly blocking?: boolean
  readonly explanation?: string
  readonly draftPath?: string
}

export type MenuReplacementComparison = {
  readonly rows: MenuChangeRow[]
  readonly publishable: boolean
  readonly unresolvedCount: number
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

function isNode(value: unknown): value is MenuNode {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!isNode(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)])
  )
}

function signature(value: unknown): string | undefined {
  return JSON.stringify(canonical(value))
}

function label(node: MenuNode): string {
  const first = Array.isArray(node.labels) ? node.labels[0] : undefined
  return isNode(first) && typeof first.displayName === "string"
    ? first.displayName
    : ""
}

function display(value: unknown, empty: string): string {
  if (value === undefined || value === null || value === "") return empty
  if (Array.isArray(value) && value.length === 0) return empty
  return typeof value === "string" ? value : (signature(value) ?? empty)
}

type NodeOccurrence = {
  readonly node: MenuNode
  readonly index: number
}

type NodePair = {
  readonly before: NodeOccurrence
  readonly after: NodeOccurrence
}

/** Exact occurrences are consumed first; changed names match only symmetrically. */
function matchOccurrences(before: MenuNode[], after: MenuNode[]) {
  const remainingBefore = new Set(
    before.map((node, index) => ({ node, index }))
  )
  const remainingAfter = new Set(after.map((node, index) => ({ node, index })))
  const pairs: NodePair[] = []
  const pair = (left: NodeOccurrence, right: NodeOccurrence) => {
    pairs.push({ before: left, after: right })
    remainingBefore.delete(left)
    remainingAfter.delete(right)
  }
  // Keep equal occurrences in place before consuming equal copies elsewhere.
  for (const left of remainingBefore) {
    const right = [...remainingAfter].find(
      (candidate) =>
        candidate.index === left.index &&
        signature(candidate.node) === signature(left.node)
    )
    if (right) pair(left, right)
  }
  for (const left of remainingBefore) {
    const right = [...remainingAfter].find(
      (candidate) => signature(candidate.node) === signature(left.node)
    )
    if (right) pair(left, right)
  }
  for (const left of remainingBefore) {
    const name = label(left.node)
    if (!name) continue
    const candidates = [...remainingAfter].filter(
      (entry) => label(entry.node) === name
    )
    const sources = [...remainingBefore].filter(
      (entry) => label(entry.node) === name
    )
    if (sources.length === 1 && candidates.length === 1) {
      const right = candidates[0]
      if (right) pair(left, right)
    }
  }
  // A single remaining replacement can be described exactly, including a rename.
  if (remainingBefore.size === 1 && remainingAfter.size === 1) {
    const [left] = remainingBefore
    const [right] = remainingAfter
    if (left && right) pair(left, right)
  }
  return { pairs, before: [...remainingBefore], after: [...remainingAfter] }
}

type ComparisonContext = {
  readonly draftPath?: string
  readonly key: readonly (string | number)[]
  readonly field: string
  readonly before: unknown
  readonly after: unknown
}

function fieldLabel(property: string): string {
  const names: Record<string, string> = {
    displayName: "Name",
    description: "Description",
    currencyCode: "Currency",
    units: "Amount",
    nanos: "Fractional amount",
    options: "Options",
    languageCode: "Language",
    order: "Order",
  }
  return names[property] ?? property.replace(/([a-z])([A-Z])/g, "$1 $2")
}

function fieldRow(context: ComparisonContext): MenuChangeRow {
  return {
    key: JSON.stringify(["value", ...context.key]),
    field: context.field,
    draftPath: context.draftPath,
    before: display(context.before, "Not set"),
    after: display(context.after, "Removed"),
  }
}

function valueRows(context: ComparisonContext): MenuChangeRow[] {
  const { key, field, before, after, draftPath } = context
  if (signature(before) === signature(after)) return []
  if (isNode(before) || isNode(after)) {
    const left = isNode(before) ? before : {}
    const right = isNode(after) ? after : {}
    if (
      (before !== undefined && !isNode(before)) ||
      (after !== undefined && !isNode(after))
    ) {
      return [fieldRow(context)]
    }
    const rows = [
      ...new Set([...Object.keys(left), ...Object.keys(right)]),
    ].flatMap((property) => {
      const child = {
        key: [...key, property],
        draftPath: draftPath ? `${draftPath}.${property}` : undefined,
        field: ["labels", "attributes", "sections", "items"].includes(property)
          ? field
          : `${field} · ${fieldLabel(property)}`,
        before: left[property],
        after: right[property],
      }
      if (property === "sections" || property === "items") {
        const a = left[property]
        const b = right[property]
        if (
          Array.isArray(a) &&
          a.every(isNode) &&
          Array.isArray(b) &&
          b.every(isNode)
        ) {
          return collectionRows({ ...child, before: a, after: b })
        }
      }
      return valueRows(child)
    })
    return rows.length ? rows : [fieldRow(context)]
  }
  if (
    key.at(-1) === "labels" &&
    Array.isArray(before) &&
    Array.isArray(after)
  ) {
    const rows = Array.from(
      { length: Math.max(before.length, after.length) },
      (_, index) =>
        valueRows({
          key: [...key, index],
          draftPath: draftPath ? `${draftPath}[${index}]` : undefined,
          field: index === 0 ? field : `${field} · Translation ${index + 1}`,
          before: before[index],
          after: after[index],
        })
    ).flat()
    return rows.length ? rows : [fieldRow(context)]
  }
  return [fieldRow(context)]
}

function describeOccurrences(entries: NodeOccurrence[]): string {
  const summaries = entries.map(({ node }, index) => {
    const first = Array.isArray(node.labels) ? node.labels[0] : undefined
    const description =
      isNode(first) && typeof first.description === "string"
        ? first.description
        : ""
    const attributes = isNode(node.attributes) ? node.attributes : {}
    const price = isNode(attributes.price) ? attributes.price : null
    const amount = price
      ? formatMenuPrice({
          currencyCode:
            typeof price.currencyCode === "string" ? price.currencyCode : null,
          units: String(price.units ?? "0"),
          nanos: typeof price.nanos === "number" ? price.nanos : 0,
        })
      : ""
    return `${index + 1}. ${[label(node) || "Unnamed entry", description, amount].filter(Boolean).join(" — ")}`
  })
  return `${entries.length} ${entries.length === 1 ? "entry" : "entries"}: ${summaries.join("; ")}`
}

function collectionRows(
  context: ComparisonContext & {
    readonly before: MenuNode[]
    readonly after: MenuNode[]
  }
): MenuChangeRow[] {
  const { key, field, before, after, draftPath } = context
  const matches = matchOccurrences(before, after)
  const rows = matches.pairs.flatMap((pair) => {
    const pairKey = [...key, "pair", pair.before.index, pair.after.index]
    const name = `${field} · ${label(pair.after.node) || `entry ${pair.after.index + 1}`}`
    const changes = valueRows({
      key: pairKey,
      draftPath: draftPath ? `${draftPath}[${pair.after.index}]` : undefined,
      field: name,
      before: pair.before.node,
      after: pair.after.node,
    })
    if (pair.before.index !== pair.after.index) {
      changes.unshift({
        key: JSON.stringify(["order", ...pairKey]),
        field: `${name} · order`,
        draftPath: draftPath ? `${draftPath}[${pair.after.index}]` : undefined,
        before: String(pair.before.index + 1),
        after: String(pair.after.index + 1),
      })
    }
    return changes
  })
  if (matches.before.length > 0 && matches.after.length > 0) {
    rows.push({
      key: JSON.stringify([...key, "unresolved"]),
      field: `${field} · unresolved matching`,
      draftPath,
      before: describeOccurrences(matches.before),
      after: describeOccurrences(matches.after),
      blocking: true,
      explanation:
        "These entries cannot be matched reliably. Review their names and contents before publishing; no individual additions or removals have been inferred.",
    })
  } else {
    for (const entry of matches.before) {
      rows.push({
        key: JSON.stringify([...key, "removed", entry.index]),
        field: `${field} · ${label(entry.node) || `entry ${entry.index + 1}`}`,
        before: display(entry.node, "Not set"),
        after: "Removed from Google",
      })
    }
    for (const entry of matches.after) {
      rows.push({
        key: JSON.stringify([...key, "added", entry.index]),
        draftPath: draftPath ? `${draftPath}[${entry.index}]` : undefined,
        field: `${field} · ${label(entry.node) || `entry ${entry.index + 1}`}`,
        before: "Not on Google",
        after: display(entry.node, "Removed"),
      })
    }
  }
  return rows
}

/** Compare the entire outbound replacement, independently of inbound keep-local rules. */
export function compareMenuReplacement(input: {
  readonly draft: MenuNode[]
  readonly google: MenuNode[]
}): MenuReplacementComparison {
  const rows = collectionRows({
    key: ["menus"],
    draftPath: "menus",
    field: "Menu",
    before: input.google,
    after: input.draft,
  })
  const unresolvedCount = rows.filter((row) => row.blocking).length
  return { rows, publishable: unresolvedCount === 0, unresolvedCount }
}

export function menuChangeRows(input: {
  readonly draft: MenuNode[]
  readonly google: MenuNode[]
}): MenuChangeRow[] {
  return compareMenuReplacement(input).rows
}
