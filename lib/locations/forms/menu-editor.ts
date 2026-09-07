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
export function withLabel(node: MenuRecord, patch: Partial<MenuLabel>): MenuRecord {
  const labels = Array.isArray(node.labels) ? [...node.labels] : []
  const first = { ...record(labels[0]), ...patch }
  return { ...node, labels: [first, ...labels.slice(1)] }
}

const SYMBOLS: Record<string, string> = {
  GBP: "£", EUR: "€", USD: "$", AUD: "$", CAD: "$", NZD: "$", INR: "₹", JPY: "¥",
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
  if (!Number.isInteger(nanos) || Math.abs(nanos) >= 1_000_000_000) return "Invalid price"
  const negative = units.startsWith("-") || nanos < 0
  const fraction = String(Math.abs(nanos)).padStart(9, "0").replace(/0+$/, "").padEnd(2, "0")
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
    return { ok: false, error: "Enter a positive price or 0, using a decimal point (for example, 12.50). Up to 9 decimal places are supported." }
  }
  const [whole = "", fraction = ""] = value.split(".")
  const units = (whole || "0").replace(/^0+(?=\d)/, "")
  // Lexical comparison avoids floating point loss and works with an ES2017 target.
  if (units.length > 19 || (units.length === 19 && units > "9223372036854775807")) {
    return { ok: false, error: "This price is too large. Enter a smaller amount." }
  }
  return { ok: true, value: { units, nanos: Number(fraction.padEnd(9, "0")) } }
}

export function withPrice(item: MenuRecord, raw: string, currencyCode = currencyOf(item)): MenuRecord {
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

export type EditorItem = { id: string; data: MenuRecord; priceText: string; currencyCode: string }
export type EditorSection = { id: string; data: MenuRecord; items: EditorItem[] }
export type EditorMenu = { id: string; data: MenuRecord; sections: EditorSection[] }

export function hydrateMenus(menus: MenuRecord[], prefix = "menu"): EditorMenu[] {
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

export function serializeMenus(menus: EditorMenu[]): MenuRecord[] {
  return menus.map((menu) => ({
    ...menu.data,
    ...(menu.sections.length || Array.isArray(menu.data.sections)
      ? { sections: menu.sections.map((section) => ({
          ...section.data,
          ...(section.items.length || Array.isArray(section.data.items)
            ? { items: section.items.map((item) => item.data) }
            : {}),
        })) }
      : {}),
  }))
}

export function moveBy<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const destination = index + delta
  if (index < 0 || index >= items.length || destination < 0 || destination >= items.length) return items
  const next = [...items]
  ;[next[index], next[destination]] = [next[destination]!, next[index]!]
  return next
}

export function insertAt<T>(items: T[], index: number, value: T): T[] {
  const position = Math.max(0, Math.min(index, items.length))
  return [...items.slice(0, position), value, ...items.slice(position)]
}

export type MenuIssue = {
  menuId: string
  sectionId?: string
  nodeId: string
  field: "name" | "price"
  message: string
}

export function menuIssues(menus: EditorMenu[]): MenuIssue[] {
  const issues: MenuIssue[] = []
  for (const menu of menus) {
    if (!readLabel(menu.data).displayName.trim()) {
      issues.push({ menuId: menu.id, nodeId: menu.id, field: "name", message: "Give this menu a name." })
    }
    for (const section of menu.sections) {
      const scope = { menuId: menu.id, sectionId: section.id }
      if (!readLabel(section.data).displayName.trim()) {
        issues.push({ ...scope, nodeId: section.id, field: "name", message: "Give this section a name." })
      }
      for (const item of section.items) {
        if (!readLabel(item.data).displayName.trim()) {
          issues.push({ ...scope, nodeId: item.id, field: "name", message: "Give this item a name." })
        }
        const parsed = parseMenuPrice(item.priceText)
        if (!parsed.ok) issues.push({ ...scope, nodeId: item.id, field: "price", message: parsed.error })
      }
    }
  }
  return issues
}

export type Removal =
  | { kind: "menu"; node: EditorMenu; index: number }
  | { kind: "section"; node: EditorSection; index: number; menuId: string }
  | { kind: "item"; node: EditorItem; index: number; menuId: string; sectionId: string }

/** Undo inserts into the CURRENT tree, so later edits to other items survive. */
export function restoreRemoval(menus: EditorMenu[], removal: Removal): EditorMenu[] {
  if (removal.kind === "menu") return insertAt(menus, removal.index, removal.node)
  return menus.map((menu) => {
    if (menu.id !== removal.menuId) return menu
    if (removal.kind === "section") return { ...menu, sections: insertAt(menu.sections, removal.index, removal.node) }
    return {
      ...menu,
      sections: menu.sections.map((section) => section.id === removal.sectionId
        ? { ...section, items: insertAt(section.items, removal.index, removal.node) }
        : section),
    }
  })
}

/** Human-readable structural changes supplement the existing item-by-item diff. */
export function menuStructureSummary(menus: MenuRecord[]): string {
  return menus.map((menu, m) => {
    const label = readLabel(menu)
    const sections = records(menu.sections).map((section, s) => {
      const sectionLabel = readLabel(section)
      const names = records(section.items).map((item) => {
        const value = readLabel(item)
        return `${value.displayName || "Unnamed item"}${value.description ? ` — ${value.description}` : ""}`
      })
      return `${s + 1}. ${sectionLabel.displayName || "Unnamed section"}${sectionLabel.description ? ` — ${sectionLabel.description}` : ""}: ${names.join("; ") || "No items"}`
    })
    return `${m + 1}. ${label.displayName || "Unnamed menu"}${label.description ? ` — ${label.description}` : ""}\n${sections.join("\n") || "No sections"}`
  }).join("\n\n") || "No menus"
}
