import { z } from "zod"
import { GOOGLE_LODGING_UPDATE_PATHS } from "@/lib/domain/google-lodging"
import { lodgingEditableFields, lodgingValue, setLodgingValue } from "./lodging-draft"

const envelope = z.looseObject({ lodging: z.record(z.string(), z.unknown()), diffMask: z.string() })
export function lodgingSuggestions(current: unknown, response: unknown) {
  const parsed = envelope.safeParse(response)
  if (!parsed.success) return { readable: false, rows: [], unsupportedPaths: [] }
  const masks = [...new Set(parsed.data.diffMask.split(",").map((path) => path.trim()).filter(Boolean))]
  const supported = masks.filter((path) => GOOGLE_LODGING_UPDATE_PATHS.has(path))
  const rows = lodgingEditableFields().filter((node) => supported.some((mask) => node.path === mask || node.path.startsWith(`${mask}.`) || node.kind === "time" && mask.startsWith(`${node.path}.`)))
    .map((node) => ({ path: node.path, label: node.label, current: lodgingValue(current, node.path), suggested: lodgingValue(parsed.data.lodging, node.path) }))
    .filter((row) => JSON.stringify(row.current) !== JSON.stringify(row.suggested))
  return { readable: true, rows, unsupportedPaths: masks.filter((path) => !GOOGLE_LODGING_UPDATE_PATHS.has(path)) }
}

export function acceptLodgingSuggestion(draft: unknown, suggestion: { readonly path: string; readonly suggested: unknown }) {
  if (!lodgingEditableFields().some((node) => node.path === suggestion.path)) throw new Error("Unsupported lodging suggestion field")
  return setLodgingValue(draft, suggestion.path, suggestion.suggested)
}
