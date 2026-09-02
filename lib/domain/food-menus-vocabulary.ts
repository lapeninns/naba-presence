// Client-safe food-menus vocabulary: the Google resource shape, the sync
// status enum and the pure counter. No node:crypto — hashing lives in
// lib/domain/food-menus.ts, which re-exports everything here. See
// lib/domain/README.md.

export type GoogleFoodMenus = {
  name: string
  menus: Array<Record<string, unknown>>
}

export const FOOD_MENUS_SYNC_STATUSES = ["in_sync", "drift"] as const
export type FoodMenusSyncStatus = (typeof FOOD_MENUS_SYNC_STATUSES)[number]

export type FoodMenuCounts = {
  menus: number
  sections: number
  items: number
  options: number
}

export function foodMenuCounts(
  menus: Array<Record<string, unknown>>
): FoodMenuCounts {
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
