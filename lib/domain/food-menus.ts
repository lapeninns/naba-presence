// Server-only (imports node:crypto). The client-safe vocabulary and counter
// live in lib/domain/food-menus-vocabulary.ts and are re-exported here so
// existing imports keep working.
import { createHash } from "node:crypto"

export * from "@/lib/domain/food-menus-vocabulary"

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
