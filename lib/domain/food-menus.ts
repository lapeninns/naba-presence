import { createHash } from "node:crypto"

export type GoogleFoodMenus = {
  name: string
  menus: Array<Record<string, unknown>>
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)])
    )
  }
  return value
}

export function hashFoodMenus(menus: Array<Record<string, unknown>>) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(menus)))
    .digest("hex")
}

export function foodMenuCounts(menus: Array<Record<string, unknown>>) {
  let sections = 0
  let items = 0
  let options = 0
  for (const menu of menus) {
    const menuSections = Array.isArray(menu.sections) ? menu.sections : []
    sections += menuSections.length
    for (const section of menuSections) {
      if (!section || typeof section !== "object") continue
      const sectionItems = (section as Record<string, unknown>).items
      if (Array.isArray(sectionItems)) {
        items += sectionItems.length
        for (const item of sectionItems) {
          if (!item || typeof item !== "object") continue
          const itemOptions = (item as Record<string, unknown>).options
          if (Array.isArray(itemOptions)) options += itemOptions.length
        }
      }
    }
  }
  return { menus: menus.length, sections, items, options }
}
