import { z } from "zod"

// Mirrors saveSchema.menus in app/api/locations/[id]/food-menus/route.ts — keep in sync.
export const foodMenusFormSchema = z.array(z.record(z.string(), z.unknown())).max(100)
export type FoodMenu = z.infer<typeof foodMenusFormSchema>[number]

// Client-safe re-implementation of lib/domain/food-menus.ts foodMenuCounts
// (that module imports node:crypto so cannot be bundled for the client).
export function countFoodMenus(menus: Array<Record<string, unknown>>) {
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
