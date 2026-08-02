import { z } from "zod"

// Client-safe leaves for the fields the industry editor actually touches. The
// server payload is a freeform record (z.record) so these mirror only the leaves
// the UI writes — everything else on the Google resource is preserved (D8).
export const businessCallsLeafSchema = z.object({ callsState: z.enum(["ENABLED", "DISABLED"]) })
export const lodgingLeafSchema = z.object({
  policies: z.object({ checkinTime: z.string().optional(), checkoutTime: z.string().optional() }).partial().optional(),
})

// Top-level keys whose value changed between the loaded resource and the draft.
export function touchedMask(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
}
