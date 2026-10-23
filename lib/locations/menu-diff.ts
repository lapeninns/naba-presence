import type { MenuPrice } from "@/lib/domain/food-menu-import"
import { readPrice } from "@/lib/locations/forms/menu-editor"

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
  const code = price.currencyCode || "GBP"
  const symbol = code === "GBP" ? "£" : `${code} `
  // The confirmation must show the same exact amount as the editor.
  // Converting int64 units to Number or rounding nanos to two places could
  // conceal a real price change (12.499 and 12.50 both read "12.50").
  return `${symbol}${readPrice({ attributes: { price } })}`
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

function count(total: number, singular: string, plural: string): string {
  return `${total} ${total === 1 ? singular : plural}`
}

function firstDescription(node: MenuNode): string {
  const first = Array.isArray(node.labels) ? node.labels[0] : undefined
  return isNode(first) && typeof first.description === "string"
    ? first.description
    : ""
}

function priceOf(value: unknown): string {
  if (!isNode(value)) return ""
  return formatMenuPrice({
    currencyCode:
      typeof value.currencyCode === "string" ? value.currencyCode : null,
    units: String(value.units ?? "0"),
    nanos: typeof value.nanos === "number" ? value.nanos : 0,
  })
}

function isPriceShaped(value: MenuNode): boolean {
  const keys = Object.keys(value)
  return (
    keys.length > 0 &&
    keys.every((key) => ["currencyCode", "units", "nanos"].includes(key)) &&
    ("units" in value || "nanos" in value)
  )
}

/**
 * A menu, section or item in one line a guest-facing operator can read:
 * "Lunch — 2 sections · 9 items", "Soup — Fresh soup — £6.00".
 */
function describeNode(node: MenuNode): string {
  const sections = Array.isArray(node.sections) ? node.sections : null
  const items = Array.isArray(node.items) ? node.items : null
  const attributes = isNode(node.attributes) ? node.attributes : {}
  const options = Array.isArray(node.options) ? node.options.length : 0
  let detail = ""
  if (sections) {
    const itemTotal = sections.reduce(
      (total: number, section) =>
        total +
        (isNode(section) && Array.isArray(section.items)
          ? section.items.length
          : 0),
      0
    )
    detail = `${count(sections.length, "section", "sections")} · ${count(itemTotal, "item", "items")}`
  } else if (items) {
    detail = count(items.length, "item", "items")
  }
  return [
    label(node) || "Unnamed entry",
    firstDescription(node),
    detail,
    priceOf(attributes.price),
    options > 0 ? count(options, "option", "options") : "",
  ]
    .filter(Boolean)
    .join(" — ")
}

/** Plain words for any menu value. Never JSON, braces or brackets. */
function describeValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return ""
  if (typeof value === "string") return value
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number" || typeof value === "bigint")
    return String(value)
  if (Array.isArray(value)) {
    const parts = value.map(describeValue).filter(Boolean)
    return parts.join(value.some(isNode) ? "; " : ", ")
  }
  if (!isNode(value)) return String(value)
  if (isPriceShaped(value)) return priceOf(value)
  if ("labels" in value || "sections" in value || "items" in value)
    return describeNode(value)
  const parts = Object.entries(value)
    .map(([key, entry]) => [key, describeValue(entry)] as const)
    .filter(([, text]) => text !== "")
    .map(([key, text]) => `${fieldLabel(key)}: ${text}`)
  return parts.join(", ")
}

function display(value: unknown, empty: string): string {
  if (value === undefined || value === null || value === "") return empty
  if (Array.isArray(value) && value.length === 0) return empty
  // An empty object carries no information, but it is a real change to the
  // replacement, so say so rather than show nothing.
  return describeValue(value) || (isNode(value) ? "Empty" : empty)
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
    price: "Price",
    dietaryRestriction: "Dietary restrictions",
    options: "Options",
    languageCode: "Language",
    order: "Order",
  }
  if (names[property]) return names[property]
  const words = property.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
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
      // A price is one value to a person: "£6.00" to "€7.00", not three rows
      // for currency, units and nanos.
      if (property === "price")
        return signature(child.before) === signature(child.after)
          ? []
          : [fieldRow(child)]
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
    const attributes = isNode(node.attributes) ? node.attributes : {}
    const description = firstDescription(node)
    const amount = priceOf(attributes.price)
    return `${index + 1}. ${[label(node) || "Unnamed entry", description, amount].filter(Boolean).join(" — ")}`
  })
  return `${entries.length} ${entries.length === 1 ? "entry" : "entries"}: ${summaries.join("; ")}`
}

/**
 * What sits inside a menu or section that is added or removed whole: one row
 * per section and item, so the person consenting sees every dish and price,
 * not just a count.
 */
function containedRows(
  node: MenuNode,
  field: string,
  key: readonly (string | number)[],
  side: "added" | "removed"
): MenuChangeRow[] {
  const children = (value: unknown) =>
    Array.isArray(value) ? value.filter(isNode) : []
  const row = (
    child: MenuNode,
    path: readonly number[],
    parentField: string
  ): MenuChangeRow[] => {
    const childField = `${parentField} · ${label(child) || `entry ${(path.at(-1) ?? 0) + 1}`}`
    const summary = describeNode(child)
    const own: MenuChangeRow =
      side === "added"
        ? {
            key: JSON.stringify([...key, side, "inside", ...path]),
            field: childField,
            before: "Not on Google",
            after: summary,
          }
        : {
            key: JSON.stringify([...key, side, "inside", ...path]),
            field: childField,
            before: summary,
            after: "Removed from Google",
          }
    const inner = [
      ...children(child.sections),
      ...children(child.items),
    ].flatMap((grandchild, index) =>
      row(grandchild, [...path, index], childField)
    )
    return [own, ...inner]
  }
  return [...children(node.sections), ...children(node.items)].flatMap(
    (child, index) => row(child, [index], field)
  )
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
      rows.push(
        ...containedRows(
          entry.node,
          `${field} · ${label(entry.node) || `entry ${entry.index + 1}`}`,
          [...key, entry.index],
          "removed"
        )
      )
    }
    for (const entry of matches.after) {
      rows.push({
        key: JSON.stringify([...key, "added", entry.index]),
        draftPath: draftPath ? `${draftPath}[${entry.index}]` : undefined,
        field: `${field} · ${label(entry.node) || `entry ${entry.index + 1}`}`,
        before: "Not on Google",
        after: display(entry.node, "Removed"),
      })
      rows.push(
        ...containedRows(
          entry.node,
          `${field} · ${label(entry.node) || `entry ${entry.index + 1}`}`,
          [...key, entry.index],
          "added"
        )
      )
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
