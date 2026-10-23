/** Client-only menu editing helpers. Never add editor IDs to Google's payload. */
export type MenuRecord = Record<string, unknown>
export type MenuLabel = { displayName: string; description: string }

export function record(value: unknown): MenuRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as MenuRecord)
    : {}
}

export function records(value: unknown): MenuRecord[] {
  return Array.isArray(value) ? value.map(record) : []
}

export function readLabel(node: MenuRecord): MenuLabel {
  const first = record(Array.isArray(node.labels) ? node.labels[0] : undefined)
  return {
    displayName: typeof first.displayName === "string" ? first.displayName : "",
    description: typeof first.description === "string" ? first.description : "",
  }
}

/** Change the primary label only; translations and unknown properties survive. */
export function withLabel(
  node: MenuRecord,
  patch: Partial<MenuLabel>
): MenuRecord {
  const labels = Array.isArray(node.labels) ? [...node.labels] : []
  const first = { ...record(labels[0]), ...patch }
  return { ...node, labels: [first, ...labels.slice(1)] }
}

const SYMBOLS: Record<string, string> = {
  GBP: "£",
  EUR: "€",
  USD: "$",
  AUD: "$",
  CAD: "$",
  NZD: "$",
  INR: "₹",
  JPY: "¥",
}

export function currencyOf(item: MenuRecord): string {
  const code = record(record(item.attributes).price).currencyCode
  return typeof code === "string" && code ? code : "GBP"
}

export function currencySymbol(code: string): string {
  return SYMBOLS[code] ?? code
}

/** Exact decimal formatting: do not round imported nanos or parse int64 as Number. */
export function readPrice(item: MenuRecord): string {
  const price = record(record(item.attributes).price)
  if (price.units === undefined && price.nanos === undefined) return ""
  const units = String(price.units ?? "0")
  const nanos = typeof price.nanos === "number" ? price.nanos : 0
  if (!Number.isInteger(nanos) || Math.abs(nanos) >= 1_000_000_000)
    return "Invalid price"
  const negative = units.startsWith("-") || nanos < 0
  const fraction = String(Math.abs(nanos))
    .padStart(9, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0")
  return `${negative ? "-" : ""}${units.replace(/^-/, "")}.${fraction}`
}

export type PriceResult =
  | { ok: true; value: { units: string; nanos: number } | null }
  | { ok: false; error: string }

/** Raw input stays raw in the editor. Conversion never changes the displayed text. */
export function parseMenuPrice(raw: string): PriceResult {
  const value = raw.trim()
  if (value === "") return { ok: true, value: null }
  if (!/^(?:\d+(?:\.\d{0,9})?|\.\d{1,9})$/.test(value)) {
    return {
      ok: false,
      error:
        "Enter a positive price or 0, using a decimal point (for example, 12.50). Up to 9 decimal places are supported.",
    }
  }
  const [whole = "", fraction = ""] = value.split(".")
  const units = (whole || "0").replace(/^0+(?=\d)/, "")
  // Lexical comparison avoids floating point loss and works with an ES2017 target.
  if (
    units.length > 19 ||
    (units.length === 19 && units > "9223372036854775807")
  ) {
    return {
      ok: false,
      error: "This price is too large. Enter a smaller amount.",
    }
  }
  return { ok: true, value: { units, nanos: Number(fraction.padEnd(9, "0")) } }
}

export function withPrice(
  item: MenuRecord,
  raw: string,
  currencyCode = currencyOf(item)
): MenuRecord {
  const parsed = parseMenuPrice(raw)
  if (!parsed.ok) return item // Never turn invalid input into zero or send NaN.
  const attributes = { ...record(item.attributes) }
  if (parsed.value === null) {
    delete attributes.price
  } else {
    attributes.price = {
      ...record(attributes.price),
      currencyCode,
      ...parsed.value,
    }
  }
  return { ...item, attributes }
}

export type EditorItem = {
  id: string
  data: MenuRecord
  priceText: string
  currencyCode: string
}
export type EditorSection = {
  id: string
  data: MenuRecord
  items: EditorItem[]
}
export type EditorMenu = {
  id: string
  data: MenuRecord
  sections: EditorSection[]
}

export function hydrateMenus(
  menus: MenuRecord[],
  prefix = "menu"
): EditorMenu[] {
  return menus.map((data, m) => ({
    id: `${prefix}-${m}`,
    data,
    sections: records(data.sections).map((section, s) => ({
      id: `${prefix}-${m}-s${s}`,
      data: section,
      items: records(section.items).map((item, i) => ({
        id: `${prefix}-${m}-s${s}-i${i}`,
        data: item,
        priceText: readPrice(item),
        currencyCode: currencyOf(item),
      })),
    })),
  }))
}

export function moveBy<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const destination = index + delta
  if (
    index < 0 ||
    index >= items.length ||
    destination < 0 ||
    destination >= items.length
  )
    return items
  const next = [...items]
  ;[next[index], next[destination]] = [next[destination]!, next[index]!]
  return next
}

export function insertAt<T>(items: T[], index: number, value: T): T[] {
  const position = Math.max(0, Math.min(index, items.length))
  return [...items.slice(0, position), value, ...items.slice(position)]
}
